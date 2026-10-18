"""Evaluate a decision gate: would Jev have let us skip LLM calls without losing real work?

  .venv/bin/python scripts/eval_decision_gates.py --stage key_review [--source log|history] [--model M]
      [--limit 500] [--budget-usd 2.0] [--out DIR] [--concurrency 4]

--source log reads what the shadow gate logged (decision_gate_log); --source history rebuilds past LLM calls from run
traces (best effort). Repeated states (same state hash) count once: the latest labelled doc. ON-mode skips are left
out; ON-mode audit docs (sampled would-be skips the LLM still ran) count like any labelled doc. Docs are re-asked to
Jev when --source history, when the logged p_yes is missing, or when --model is a different model than the logged
one; each re-ask charges --budget-usd the larger of its reported cost and its size estimate. Only positives with a
Jev score count toward the 100-positive bar. Writes <stage>-<model>.md and .json (sweep plus per-item rows) to --out
and prints RECOMMEND ... or KEEP ... (exit code 0 either way).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # `app` is the sibling package
from app.config import get_settings  # noqa: E402
from app.db import mongo  # noqa: E402
from app.gates import history  # noqa: E402
from app.gates.evaluate import (DEFAULT_THRESHOLDS, STAGES, _failing, _best_row, count_positives,  # noqa: E402
                                dedupe_latest, estimate_cost_usd, item_from_doc, logged_item, needs_reask, Item,
                                positive_of, recommend, report_markdown, sweep, sweep_to_json)
from app.llm.decisions import close_shared_decisions_client, shared_decisions_client  # noqa: E402


async def _load(stage: str, source: str, limit: int) -> tuple[list[dict], dict[str, int]]:
    if source == "log":
        return await history.from_log(stage, limit=limit)
    if stage == "key_review":
        return await history.key_review_history(limit=limit)
    if stage == "research_window":
        return await history.research_history(limit=limit)
    print("brief_source has no history loader; use --source log")
    return [], {}


async def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--stage", required=True, choices=sorted(STAGES))
    ap.add_argument("--source", choices=["log", "history"], default="log")
    ap.add_argument("--model", default=None, help="default: settings.decisions_model")
    ap.add_argument("--limit", type=int, default=500)
    ap.add_argument("--budget-usd", type=float, default=2.0)
    ap.add_argument("--out", default=os.path.join(tempfile.gettempdir(), "decision-gates"))
    ap.add_argument("--concurrency", type=int, default=4)
    args = ap.parse_args()

    settings = get_settings()
    model = args.model or settings.decisions_model
    questions, skip_q = STAGES[args.stage]
    await mongo.connect(settings)
    client = None
    try:
        docs, load_excluded = await _load(args.stage, args.source, args.limit)
        skipped_on = sum(1 for d in docs if d.get("skipped"))
        docs = [d for d in docs if not d.get("skipped")]
        audited = sum(1 for d in docs if d.get("audit"))
        labelled_docs = [d for d in docs if positive_of(args.stage, d) is not None]
        excluded = len(docs) - len(labelled_docs)
        labelled_docs, duplicates = dedupe_latest(labelled_docs)
        labelled = [(d, bool(positive_of(args.stage, d))) for d in labelled_docs]

        def needs_ask(d: dict) -> bool:
            return needs_reask(d, source=args.source, model=model)

        spent = 0.0       # budget charged by finished re-asks: max(reported cost, estimate) each
        reported = 0.0    # cost the API reported for finished re-asks
        reserved = 0.0    # estimated cost of in-flight re-asks, so overshoot stays bounded
        budget_dropped = 0
        reask_errors = 0
        sem = asyncio.Semaphore(max(1, args.concurrency))
        if any(needs_ask(d) for d, _ in labelled):
            client = shared_decisions_client(settings)
            if client is None:
                print("OPENROUTER_API_KEY is not set; cannot re-ask Jev")
                return 0

        async def build(idx: int, d: dict, positive: bool) -> Item | None:
            nonlocal spent, reported, reserved, budget_dropped, reask_errors
            if not needs_ask(d):
                return logged_item(d, positive, idx, stage=args.stage)
            async with sem:
                try:
                    state = d["state"]
                    est = estimate_cost_usd(state)
                except Exception as exc:  # noqa: BLE001 — one bad doc must not abort the run
                    print(f"re-ask skipped for doc {idx}: {type(exc).__name__}")
                    reask_errors += 1
                    return item_from_doc(d, positive, idx, p_yes=None, jev_latency_ms=0, jev_cost_usd=0.0,
                                         stage=args.stage)
                if spent + reserved + est > args.budget_usd:
                    budget_dropped += 1
                    return None
                reserved += est
                p, lat, cost = None, 0, 0.0
                try:
                    # ScaleDown's Decisions endpoint takes only a string state (or {text, document}).
                    sent = (json.dumps(state, ensure_ascii=False, sort_keys=True)
                            if model.startswith("scaledown/") and not isinstance(state, str) else state)
                    dec = await client.decide(sent, questions, model=model)
                    p, lat, cost = dec.p_yes(skip_q), dec.latency_ms, dec.cost_usd
                except Exception as exc:  # noqa: BLE001
                    print(f"re-ask failed for doc {idx}: {type(exc).__name__}: {exc}")
                    reask_errors += 1
                finally:
                    reserved -= est
                    spent += max(cost, est)   # never charge less than the estimate (a cost the API under-reports)
                    reported += cost
            return item_from_doc(d, positive, idx, p_yes=p, jev_latency_ms=lat, jev_cost_usd=cost, stage=args.stage)

        built = await asyncio.gather(*(build(i, d, p) for i, (d, p) in enumerate(labelled)))
        items = [i for i in built if i is not None]
        positives, unscored = count_positives(items)
        rows = sweep(items, DEFAULT_THRESHOLDS)
        pick = recommend(rows, positives=positives)
        md = report_markdown(args.stage, model, items, rows, pick)
        loader = "; ".join(f"{n} x {why}" for why, n in load_excluded.items()) or "none"
        notes = (f"\n- ON-mode skips excluded: {skipped_on}\n- ON-mode audit docs (labelled, included): {audited}\n"
                 f"- excluded (no LLM label, LLM error or failed review): {excluded}\n"
                 f"- duplicates dropped (same state hash, latest kept): {duplicates}\n"
                 f"- loader exclusions: {loader}\n- unscored positives (not counted toward the bar): {unscored}\n"
                 f"- re-ask budget charged: ${spent:.4f} (reported cost ${reported:.4f})\n"
                 f"- budget_dropped: {budget_dropped}\n- re-ask errors (left unknown): {reask_errors}\n")
        md += notes
        os.makedirs(args.out, exist_ok=True)
        slug = re.sub(r"[^A-Za-z0-9._-]+", "_", model)
        base = os.path.join(args.out, f"{args.stage}-{slug}")
        with open(base + ".md", "w") as f:
            f.write(md)
        with open(base + ".json", "w") as f:
            json.dump(sweep_to_json(args.stage, model, len(items), positives, rows, pick,
                                    {"unscored_positives": unscored, "skipped_on_mode": skipped_on,
                                     "audit_docs": audited, "excluded": excluded, "duplicates_dropped": duplicates,
                                     "loader_exclusions": load_excluded, "spent_usd": spent,
                                     "reported_cost_usd": reported, "budget_dropped": budget_dropped,
                                     "reask_errors": reask_errors}, items=items), f, indent=1)
        print(f"wrote {base}.md and .json (n={len(items)}, positives={positives}, unscored_positives={unscored}, "
              f"duplicates_dropped={duplicates}, budget_dropped={budget_dropped}, reask_errors={reask_errors})")
        if pick is not None:
            print(f"RECOMMEND {args.stage} on skip_below={pick.threshold}")
        else:
            best = _best_row(rows)
            reason = _failing(best, positives) if best else "no data"
            print(f"KEEP {args.stage} shadow: {reason}")
        return 0
    finally:
        try:
            await close_shared_decisions_client()
        finally:
            await mongo.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
