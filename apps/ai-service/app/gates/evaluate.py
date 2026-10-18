"""Pure evaluation of a decision gate: sweep skip thresholds over (Jev p_yes, LLM verdict) pairs."""
from __future__ import annotations

import json
import re
import statistics
from dataclasses import asdict, dataclass

from app.gates.briefs import SOURCE_QUESTIONS
from app.gates.core import state_hash
from app.gates.keys import REVIEW_QUESTIONS
from app.gates.research import WINDOW_QUESTIONS

DEFAULT_THRESHOLDS = [0.01, 0.02, 0.03, 0.05, 0.08, 0.1, 0.15, 0.2, 0.3]

MIN_AGREEMENT = 0.95
MIN_POSITIVES = 100
MIN_SKIP_RATE = 0.15

# stage -> (questions, skip question)
STAGES: dict[str, tuple[dict, str]] = {
    "research_window": (WINDOW_QUESTIONS, "has_field_info"),
    "brief_source": (SOURCE_QUESTIONS, "describes_process"),
    "key_review": (REVIEW_QUESTIONS, "has_error"),
}

# The state field a human reads to judge an item, per stage.
EXCERPT_FIELDS = {"research_window": "text", "brief_source": "text", "key_review": "answer_key"}
EXCERPT_CHARS = 600
NEAR_MISSES = 20
MAX_DISAGREEMENTS = 50


@dataclass(frozen=True)
class Item:
    id: str
    p_yes: float | None
    positive: bool            # the LLM said work was needed
    state_excerpt: str
    llm_latency_ms: int | None
    jev_latency_ms: int
    jev_cost_usd: float
    llm_tokens: int | None
    state_hash: str | None = None


@dataclass(frozen=True)
class SweepRow:
    threshold: float
    skip_rate: float
    lost_positives: int
    agreement: float
    calls_saved: int
    net_latency_ms_per_item: float


def positive_of(stage: str, doc: dict) -> bool | None:
    label = doc.get("llm_label")
    if doc.get("llm_error") or not isinstance(label, dict) or not label:
        return None
    if stage == "research_window":
        # Positive iff the window produced at least one raw claim: a window with none can never
        # yield a kept, unverified or repaired claim.
        value = label.get("positive_raw")
    elif stage == "brief_source":
        value = (label["status"] == "extracted") if label.get("status") is not None else label.get("describes_process")
    elif stage == "key_review":
        if label.get("review_ran") is False:
            return None   # the review failed to run: no verdict, not a true negative
        value = label.get("patched")
    else:
        return None
    return None if value is None else bool(value)


def doc_state_hash(doc: dict) -> str | None:
    if doc.get("state_hash"):
        return str(doc["state_hash"])
    return state_hash(doc["state"]) if doc.get("state") is not None else None


def dedupe_latest(docs: list[dict]) -> tuple[list[dict], int]:
    """One doc per state hash: the latest by created_at (ties keep the earlier doc; loaders return newest
    first). Docs with no state are kept as they are. Returns (docs in input order, duplicates dropped)."""
    hashes = [doc_state_hash(d) for d in docs]
    best: dict[str, int] = {}
    for idx, (doc, h) in enumerate(zip(docs, hashes)):
        if h is None:
            continue
        if h not in best:
            best[h] = idx
            continue
        cur, new = docs[best[h]].get("created_at"), doc.get("created_at")
        if new is not None and (cur is None or new > cur):
            best[h] = idx
    keep = set(best.values())
    out = [d for i, (d, h) in enumerate(zip(docs, hashes)) if h is None or i in keep]
    return out, len(docs) - len(out)


_WS = re.compile(r"\s+")


def excerpt_of(stage: str | None, state) -> str:
    """What a human reads to judge the item: research and brief page text, or the key-review answer key."""
    field = EXCERPT_FIELDS.get(stage or "")
    text = state.get(field) if isinstance(state, dict) and field else None
    if not isinstance(text, str):
        text = state if isinstance(state, str) else json.dumps(state, ensure_ascii=False, default=str)
    return _WS.sub(" ", text).strip()[:EXCERPT_CHARS]


def count_positives(items: list[Item]) -> tuple[int, int]:
    """(scored, unscored) positives. Only scored positives (a known p_yes) count toward the bar."""
    scored = sum(1 for i in items if i.positive and i.p_yes is not None)
    return scored, sum(1 for i in items if i.positive) - scored


def model_family(model: str | None) -> str:
    """'typesafe/jev-1.14-20261014' and 'typesafe/jev-1.14' are the same model."""
    parts = (model or "").split("-")
    if len(parts) > 1 and parts[-1].isdigit() and len(parts[-1]) == 8:
        parts = parts[:-1]
    return "-".join(parts)


def sweep(items: list[Item], thresholds: list[float]) -> list[SweepRow]:
    n = len(items)
    if n == 0:
        return [SweepRow(t, 0.0, 0, 0.0, 0, 0.0) for t in thresholds]
    llm_lat = [i.llm_latency_ms for i in items if i.llm_latency_ms is not None]
    mean_llm = statistics.fmean(llm_lat) if llm_lat else 0.0
    mean_jev = statistics.fmean(i.jev_latency_ms for i in items)
    known = [i for i in items if i.p_yes is not None]
    rows = []
    for t in thresholds:
        skipped = [i for i in known if i.p_yes < t]          # type: ignore[operator]
        agree = sum(1 for i in known if (i.p_yes >= t) == i.positive)  # type: ignore[operator]
        # A skip saves the LLM latency of the calls actually skipped (often short "nothing here" replies).
        skipped_lat = [i.llm_latency_ms for i in skipped if i.llm_latency_ms is not None]
        saved_ms = statistics.fmean(skipped_lat) if skipped_lat else mean_llm
        rows.append(SweepRow(
            threshold=t,
            skip_rate=len(skipped) / n,
            lost_positives=sum(1 for i in skipped if i.positive),
            agreement=agree / len(known) if known else 0.0,
            calls_saved=len(skipped),
            net_latency_ms_per_item=(len(skipped) * saved_ms - n * mean_jev) / n,
        ))
    return rows


def _failing(row: SweepRow, positives: int) -> str | None:
    if positives < MIN_POSITIVES:
        return f"insufficient data: {positives} positives, need {MIN_POSITIVES}"
    if row.lost_positives != 0:
        return f"{row.lost_positives} lost positive(s), need 0"
    if row.agreement < MIN_AGREEMENT:
        return f"agreement {row.agreement:.1%}, need {MIN_AGREEMENT:.0%}"
    if row.skip_rate < MIN_SKIP_RATE:
        return f"skip rate {row.skip_rate:.1%}, need {MIN_SKIP_RATE:.0%}"
    if row.net_latency_ms_per_item <= 0:
        return f"net latency {row.net_latency_ms_per_item:.0f} ms/item, need > 0"
    return None


def recommend(rows: list[SweepRow], *, positives: int) -> SweepRow | None:
    ok = [r for r in rows if _failing(r, positives) is None]
    return max(ok, key=lambda r: r.skip_rate) if ok else None


def _best_row(rows: list[SweepRow]) -> SweepRow | None:
    if not rows:
        return None
    return min(rows, key=lambda r: (r.lost_positives, -r.skip_rate))


def _pct(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    return s[min(len(s) - 1, int(q * len(s)))]


def review_sections(items: list[Item], t: float) -> tuple[list[Item], list[Item], list[Item]]:
    """At threshold t: (every lost positive, the lowest-p positives still at or above t, disagreements
    where Jev said yes and the LLM said no, most confident first and capped)."""
    scored = [i for i in items if i.p_yes is not None]
    lost = sorted((i for i in scored if i.positive and i.p_yes < t), key=lambda i: i.p_yes)  # type: ignore[operator]
    near = sorted((i for i in scored if i.positive and i.p_yes >= t), key=lambda i: i.p_yes)[:NEAR_MISSES]  # type: ignore[operator]
    disagree = sorted((i for i in scored if not i.positive and i.p_yes >= t),  # type: ignore[operator]
                      key=lambda i: -i.p_yes)[:MAX_DISAGREEMENTS]  # type: ignore[operator]
    return lost, near, disagree


def _item_lines(items: list[Item]) -> list[str]:
    if not items:
        return ["", "(none)"]
    out: list[str] = []
    for i in items:
        out += ["", f"- `{i.id}` p_yes={i.p_yes:.3f} positive={i.positive}", f"  > {i.state_excerpt}"]
    return out


def report_markdown(stage: str, model: str, items: list[Item], rows: list[SweepRow],
                    pick: SweepRow | None) -> str:
    positives, unscored = count_positives(items)
    lat = [float(i.jev_latency_ms) for i in items]
    tokens = [i.llm_tokens for i in items if i.llm_tokens is not None]
    out = [f"# Decision gate eval: {stage}", "",
           f"- model: `{model}`",
           f"- n: {len(items)}  (unknown p_yes: {sum(1 for i in items if i.p_yes is None)})",
           f"- positives (LLM said work was needed) with a Jev score: {positives}"
           f"  (unscored positives, not counted toward the bar: {unscored})",
           f"- Jev cost total: ${sum(i.jev_cost_usd for i in items):.4f}",
           f"- Jev latency p50 / p90: {_pct(lat, 0.5):.0f} / {_pct(lat, 0.9):.0f} ms",
           f"- LLM tokens per item (mean): {statistics.fmean(tokens):.0f}" if tokens
           else "- LLM tokens per item: n/a", "",
           "| threshold | skip rate | lost positives | agreement | calls saved | net ms/item |",
           "|---|---|---|---|---|---|"]
    for r in rows:
        out.append(f"| {r.threshold} | {r.skip_rate:.1%} | {r.lost_positives} | {r.agreement:.1%} "
                   f"| {r.calls_saved} | {r.net_latency_ms_per_item:.0f} |")
    out.append("")
    focus = pick or _best_row(rows)
    if pick is not None:
        out.append(f"**Recommendation:** skip below {pick.threshold} "
                   f"(skip rate {pick.skip_rate:.1%}, agreement {pick.agreement:.1%}, 0 lost positives).")
    elif focus is not None:
        out.append(f"**Recommendation:** none. Best row (skip below {focus.threshold}) fails: "
                   f"{_failing(focus, positives)}.")
    else:
        out.append("**Recommendation:** none. No sweep rows.")
    if focus is not None:
        t = focus.threshold
        lost, near, disagree = review_sections(items, t)
        n_disagree = sum(1 for i in items if i.p_yes is not None and not i.positive and i.p_yes >= t)
        out += ["", f"## 1. Lost positives at threshold {t} ({len(lost)}, all shown)"] + _item_lines(lost)
        out += ["", f"## 2. Near misses: the {len(near)} lowest-p positives still at or above {t}"] + _item_lines(near)
        out += ["", f"## 3. Disagreements at threshold {t}: Jev yes, LLM no ({n_disagree}, "
                    f"showing up to {MAX_DISAGREEMENTS}, most confident first)"] + _item_lines(disagree)
    return "\n".join(out) + "\n"


def items_to_json(items: list[Item]) -> list[dict]:
    return [{"id": i.id, "p_yes": i.p_yes, "positive": i.positive, "state_hash": i.state_hash,
             "excerpt": i.state_excerpt} for i in items]


def sweep_to_json(stage: str, model: str, n: int, positives: int, rows: list[SweepRow],
                  pick: SweepRow | None, extra: dict | None = None, items: list[Item] | None = None) -> dict:
    out = {"stage": stage, "model": model, "n": n, "positives": positives,
           "rows": [asdict(r) for r in rows], "recommendation": asdict(pick) if pick else None,
           **(extra or {})}
    if items is not None:
        out["items"] = items_to_json(items)
    return out


def needs_reask(doc: dict, *, source: str, model: str) -> bool:
    """Re-ask Jev for history docs, docs with no logged p_yes (None, never falsy 0.0), or a different model."""
    if source == "history":
        return True
    return doc.get("p_yes") is None or model_family(doc.get("model")) != model_family(model)


def _item_id(doc: dict, h: str | None, index: int) -> str:
    """A readable id: the problem slug, page URL (plus window offsets) or span, else the state hash."""
    ctx = doc.get("context") or {}
    base = ctx.get("slug") or ctx.get("url") or ctx.get("span_id")
    if base and ctx.get("start") is not None and ctx.get("end") is not None:
        base = f"{base}#{ctx['start']}-{ctx['end']}"
    return str(base or h or index)


def item_from_doc(doc: dict, positive: bool, index: int, *, p_yes: float | None, jev_latency_ms: int,
                  jev_cost_usd: float, stage: str | None = None) -> Item:
    h = doc_state_hash(doc)
    tokens = doc.get("llm_tokens")
    return Item(id=_item_id(doc, h, index), p_yes=p_yes, positive=positive,
                state_excerpt=excerpt_of(stage, doc.get("state")),
                llm_latency_ms=doc.get("llm_latency_ms"), jev_latency_ms=jev_latency_ms,
                jev_cost_usd=jev_cost_usd, llm_tokens=int(tokens) if tokens is not None else None,
                state_hash=h)


def logged_item(doc: dict, positive: bool, index: int, *, stage: str | None = None) -> Item:
    """Item straight from the logged verdict (no re-ask)."""
    return item_from_doc(doc, positive, index, p_yes=doc.get("p_yes"),
                         jev_latency_ms=int(doc.get("jev_latency_ms") or 0),
                         jev_cost_usd=float(doc.get("jev_cost_usd") or 0.0), stage=stage)


USD_PER_M_TOKENS = 0.042


def estimate_cost_usd(state) -> float:
    text = state if isinstance(state, str) else json.dumps(state, ensure_ascii=False, default=str)
    return (len(text.encode()) / 4) * USD_PER_M_TOKENS / 1_000_000
