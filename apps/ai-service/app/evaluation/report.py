"""The candidate's report document (spec §11.3), snake_case. Pure: no I/O, no LLM.

Built from the merged grades, the synthesis and the score arithmetic. Candidate-visible text only: the transcript never carries
orders, tool calls or briefs, and quotes only cite turns that appear in it. An unscorable round carries just why, the meta and
the transcript."""
from __future__ import annotations

import base64
import gzip
import json
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Any

from app.blueprint import topics as T
from app.evaluation.inputs import DeliveryStats, PartInput, VisibleTurn
from app.evaluation.models import GapTopic, PartGrade, SessionMeta, Synthesis, TopicGap
from app.evaluation.topics_util import NO_PRACTICE_SUBJECTS, Source, clean_bank_tags, topics_of, words
from app.evaluation.score import EVENT_LABELS, Adjustment, ScoreResult
from app.evaluation.weights import EVAL_VERSION, EVAL_WEIGHTS_VERSION, FAMILIES, areas_for

_CODE_FAMILIES = frozenset({"dsa", "online-assessment", "lld"})
_INTEGRITY_KINDS = ("proctor", "paste", "away_overstay")
AUTO_FAIL = "automatic fail"


# ---------------------------------------------------------------- helpers

def to_iso(at: Any) -> str:
    """Epoch seconds or milliseconds, or an ISO string, as an ISO string."""
    if isinstance(at, bool) or at is None:
        return ""
    if isinstance(at, (int, float)):
        secs = float(at) / 1000.0 if float(at) > 1e11 else float(at)
        if secs < 1e9:                      # a monotonic clock reading, not a wall-clock time
            return ""
        try:
            return datetime.fromtimestamp(secs, timezone.utc).isoformat()
        except (OverflowError, OSError, ValueError):
            return ""
    return str(at)


def epoch(at: Any) -> float | None:
    if isinstance(at, bool) or at is None:
        return None
    if isinstance(at, (int, float)):
        return float(at) / 1000.0 if float(at) > 1e11 else float(at)
    try:
        return datetime.fromisoformat(str(at)).timestamp()
    except ValueError:
        return None


# The live conductor's ending rules (app/interviewer/conductor.py: `conduct_end_at`, `IMMEDIATE_CONDUCT`, `proctor_end_at`, away_cap).
_CONDUCT_END_AT = 2
_IMMEDIATE_CONDUCT = frozenset({"abusive", "director:end"})
_PROCTOR_END_AT = 3


def _clock(x: Any) -> float | None:
    return float(x) if isinstance(x, (int, float)) and not isinstance(x, bool) else None


def _conduct_end(cp: dict) -> tuple[bool, float | None]:
    """Whether the conduct ledger reached an ending, and when (the conductor's clock) the incident that ended it came."""
    for n, c in enumerate(cp.get("conduct") or []):
        if c.get("kind") in _IMMEDIATE_CONDUCT or n + 1 >= _CONDUCT_END_AT:
            return True, _clock(c.get("at"))
    return False, None


def _integrity_end(cp: dict) -> tuple[bool, float | None]:
    """Whether the proctor ledger reached an ending (the third full violation, or away past the cap), and when."""
    full = 0
    for e in cp.get("proctor") or []:
        if e.get("kind") == "away_cap":
            return True, _clock(e.get("seen_at"))
        if float(e.get("weight", 1) or 0) >= 1:
            full += 1
            if full >= _PROCTOR_END_AT:
                return True, _clock(e.get("seen_at"))
    if int(cp.get("full_violations") or 0) >= _PROCTOR_END_AT:
        return True, None
    return False, None


def end_cause(run: dict) -> str | None:
    """What ended a round the interviewer ended: "conduct" or "integrity", by the ledger that actually reached its ending (the earlier
    one when both did), never by an earlier conduct warning. None when the interviewer did not end the round."""
    if run.get("end_reason") != "ended_by_interviewer":
        return None
    cp = run.get("checkpoint") or {}
    conduct, c_at = _conduct_end(cp)
    integrity, i_at = _integrity_end(cp)
    if conduct and integrity:
        if c_at is not None and i_at is not None:
            return "integrity" if i_at < c_at else "conduct"
        return "integrity" if c_at is None and i_at is not None else "conduct"
    if conduct:
        return "conduct"
    if integrity:
        return "integrity"
    # neither ledger reached its ending (other rules in force): the conduct ledger if it has anything, else none
    return "conduct" if cp.get("conduct") else None


def auto_fail_reason(run: dict) -> str | None:
    """Why the round was an automatic fail: the interviewer ended it for conduct or integrity (spec §8.2). None when it was not."""
    cause = end_cause(run)
    if cause == "conduct":
        return "The interviewer ended the round because of conduct."
    if cause == "integrity":
        return "The interviewer ended the round because of repeated screen switching."
    return None


def question_ids(merged: dict[str, PartGrade]) -> dict[str, tuple[str, str]]:
    """Report question id -> (part id, the grader's question id). The grader's id is kept when unique across parts, else prefixed."""
    counts: dict[str, int] = {}
    for g in merged.values():
        for q in g.questions:
            counts[q.id] = counts.get(q.id, 0) + 1
    return {(q.id if counts[q.id] == 1 else f"{pid}:{q.id}"): (pid, q.id) for pid, g in merged.items() for q in g.questions}


def decode_scene(blob: str | bytes | None) -> dict | None:
    """The final whiteboard scene: base64 of a gzipped Excalidraw scene JSON (a plain JSON blob is tolerated)."""
    if not blob:
        return None
    try:
        raw = base64.b64decode(blob)
        try:
            raw = gzip.decompress(raw)
        except OSError:
            pass
        scene = json.loads(raw)
        return scene if isinstance(scene, dict) else None
    except Exception:  # noqa: BLE001 - a damaged scene is simply not shown
        return None


def _minutes_played(visible: list[VisibleTurn]) -> float:
    stamps = [t for t in (epoch(v.at) for v in visible) if t is not None]
    return round((max(stamps) - min(stamps)) / 60.0, 1) if len(stamps) >= 2 else 0.0


def _meta(meta: SessionMeta, visible: list[VisibleTurn]) -> dict:
    return {**meta.model_dump(mode="json"), "minutes_played": _minutes_played(visible), "weights_version": EVAL_WEIGHTS_VERSION,
            "eval_version": EVAL_VERSION}


def _transcript(visible: list[VisibleTurn], markers: dict[int, list[dict]]) -> list[dict]:
    return [{"turn_id": v.turn_id, "speaker": v.speaker, "text": v.text, "at": v.at, "markers": markers.get(v.turn_id, []),
             "cut_off": v.cut_off} for v in visible]


def unscorable_report(meta: SessionMeta, visible: list[VisibleTurn], reason: str) -> dict:
    return {"outcome": "unscorable", "unscorable_reason": reason, "meta": _meta(meta, visible), "transcript": _transcript(visible, {}),
            "weights_version": EVAL_WEIGHTS_VERSION, "eval_version": EVAL_VERSION}


# ---------------------------------------------------------------- sections

def _areas(parts: list[PartInput], merged: dict[str, PartGrade], shares: dict[str, float], meta: SessionMeta,
           previous: dict[str, float] | None) -> list[dict]:
    """One row per area key across the round's parts: the share-and-weight weighted mean, the share of the round it is worth (%)."""
    acc: dict[str, dict] = {}
    for p in parts:
        g = merged.get(p.part_id)
        if g is None or p.family not in FAMILIES or shares.get(p.part_id, 0) <= 0:
            continue
        labels = {a.key: a for a in areas_for(p.family, meta.company)}
        total_w = sum(a.weight for a in labels.values() if any(x.key == a.key for x in g.areas)) or 1
        for ag in g.areas:
            area = labels.get(ag.key)
            if area is None:
                continue
            row = acc.setdefault(ag.key, {"key": ag.key, "label": area.label, "w": 0.0, "ws": 0.0, "reason": "", "evidence": [], "_best": 0.0})
            w = shares[p.part_id] * area.weight / total_w
            row["w"] += w
            row["ws"] += w * ag.score
            row["evidence"] += [e for e in ag.evidence if e not in row["evidence"]]
            if w > row["_best"]:
                row["_best"], row["reason"] = w, ag.reason
    out = []
    for key, r in acc.items():
        out.append({"key": key, "label": r["label"], "weight": round(r["w"] * 100), "score": round(r["ws"] / r["w"], 1) if r["w"] else 1.0,
                    "reason": r["reason"], "evidence": r["evidence"],
                    "previous_score": (previous or {}).get(key)})
    return sorted(out, key=lambda a: -a["weight"])


def _questions(parts: list[PartInput], merged: dict[str, PartGrade], run: dict) -> list[dict]:
    ids = {v: k for k, v in question_ids(merged).items()}
    scene = decode_scene(run.get("board_scene"))
    board_owner = None
    for p in parts:                                  # the final board belongs to the last part that has one
        if p.board and p.part_id in merged:
            board_owner = p.part_id
    if board_owner is None and scene is not None:
        board_owner = next((p.part_id for p in reversed(parts) if p.family in ("system-design", "lld") and p.part_id in merged), None)
    out: list[dict] = []
    for p in parts:
        g = merged.get(p.part_id)
        if g is None:
            continue
        for n, q in enumerate(g.questions):
            card = {"id": ids[(p.part_id, q.id)], "part": p.part_id, "kind": p.family, "title": p.title, "asked": p.title if q.id == "main" else q.asked,
                    "origin": "candidate_led" if q.id == "main" else q.origin, "intent": q.intent if q.origin == "candidate_led" or q.id == "main" else "",
                    "answer_quotes": [x.model_dump() for x in q.answer_quotes], "verdict": q.verdict, "score": q.score,
                    "strong_answer": q.strong_answer, "gap": q.gap, "topics": [t.model_dump() for t in q.topics],
                    "resume_consistency": q.resume_consistency, "resume_note": q.resume_note}
            if n == 0 and p.code is not None and p.family in _CODE_FAMILIES:
                c = g.code
                card["code"] = {"language": p.code.get("language") or "", "text": p.code.get("text") or "",
                                "trace": [s.model_dump() for s in c.trace] if c else [],
                                "logic_works": c.logic_works if c else "no", "syntax_slips": list(c.syntax_slips) if c else []}
            if n == 0 and p.board:
                card["board"] = {"summary": p.board, "notes": [m.note for m in g.moments],
                                 "scene": scene if p.part_id == board_owner else None}
            elif n == 0 and p.part_id == board_owner and scene is not None:
                card["board"] = {"summary": "", "notes": [m.note for m in g.moments], "scene": scene}
            out.append(card)
    return out


def _conduct(run: dict, adjs: list[Adjustment], reason: str | None, visible: list[VisibleTurn]) -> list[dict]:
    cp = run.get("checkpoint") or {}
    at_of = {v.turn_id: v.at for v in visible}
    deltas = [a for a in adjs if a.kind in ("conduct_warning", "conduct_final_warning", "conduct_abuse")]
    out = [{"kind": a.kind, "at": at_of.get(a.turn_id) or to_iso(a.at), "turn_id": a.turn_id, "effect": a.delta} for a in deltas]
    if reason and cp.get("conduct") and end_cause(run) == "conduct":
        last = cp["conduct"][-1]
        tid = last.get("turn_id")
        tid = int(tid) if str(tid).isdigit() else None
        out.append({"kind": last.get("kind") or "conduct", "at": at_of.get(tid) or to_iso(last.get("at")), "turn_id": tid, "effect": AUTO_FAIL})
    return out


def _integrity(run: dict, adjs: list[Adjustment], reason: str | None, visible: list[VisibleTurn]) -> list[dict]:
    cp = run.get("checkpoint") or {}
    at_of = {v.turn_id: v.at for v in visible}
    out = [{"kind": _event_kind(a), "at": at_of.get(a.turn_id) or to_iso(a.at),
            "turn_id": a.turn_id, "effect": a.delta} for a in adjs if a.kind in _INTEGRITY_KINDS]
    free = next((e for e in cp.get("proctor") or [] if e.get("kind") not in ("away_overstay", "away_cap") and float(e.get("weight", 1)) >= 1), None)
    if free is not None:
        out.append({"kind": free.get("kind"), "at": to_iso(free.get("at")), "turn_id": None, "effect": 0.0})
    if reason and end_cause(run) == "integrity":
        last = (cp.get("proctor") or [{}])[-1]
        out.append({"kind": last.get("kind") or "integrity", "at": to_iso(last.get("at")), "turn_id": None, "effect": AUTO_FAIL})
    return sorted(out, key=lambda e: e["at"])


def _event_kind(a: Adjustment) -> str:
    """The integrity row's kind: the proctor ledger's kind (a report stored before `event_kind` existed kept it in the note)."""
    if a.kind != "proctor":
        return a.kind
    return a.event_kind or (a.note if a.note in EVENT_LABELS else a.kind)


def _markers(visible: list[VisibleTurn], merged: dict[str, PartGrade], run: dict, hint_turns: list[int]) -> dict[int, list[dict]]:
    shown = {v.turn_id for v in visible}
    out: dict[int, list[dict]] = {}

    def add(turn_id: int | None, kind: str, note: str = "") -> None:
        if turn_id is None or turn_id not in shown:
            return
        m = {"kind": kind, "note": note}
        if m not in out.setdefault(turn_id, []):
            out[turn_id].append(m)

    for t in hint_turns:
        add(t, "hint")
    for w in (run.get("checkpoint") or {}).get("warnings_given") or []:
        add(w.get("turn"), "warning")
    for g in merged.values():
        asked = {h.turn_id for h in g.events.help_requests if h.kind in ("clarification", "repeat")}
        for m in g.moments:
            if m.turn_id in asked and m.kind in ("bug", "weak"):   # a clarifying question is never marked as a mistake
                continue
            add(m.turn_id, m.kind, m.note)
    return out


# ---------------------------------------------------------------- abandoned problems (owner decision 2026-10-18)

REVISIT_WHY = ("You asked to switch away from this problem. Interviewers read that as not knowing it — learn its approach and practise it "
               "until you can solve it out loud.")
_SUBJECTS = {"dsa": "DSA", "online-assessment": "DSA", "system-design": "System design", "lld": "LLD"}


def _abandoned(parts: list[PartInput]) -> list[PartInput]:
    return [p for p in parts if p.swapped and p.ran]


def _focus(synthesis: Synthesis, parts: list[PartInput]) -> list[dict]:
    revisit = [{"title": f"Revisit {p.title}", "why": REVISIT_WHY,
                "moments": [t.turn_id for t in p.turns if t.speaker == "candidate"]} for p in _abandoned(parts)]
    return revisit + [{"title": f.title, "why": f.why, "example_quote": f.example_quote, "example_note": f.example_note, "moments": f.turn_ids}
                      for f in synthesis.focus]


def problem_bank_tags(p: PartInput, vocab: list[str] | None) -> list[str] | None:
    """The problem's own raw bank tags validated against the vocabulary, rarest first and at most 3; None when it has none to offer."""
    tags = clean_bank_tags(list((p.reference or {}).get("bank_tags") or []), vocab)
    if not tags:
        return None
    rank = {v.lower(): i for i, v in enumerate(vocab or [])}
    return sorted(tags, key=lambda x: -rank.get(x.lower(), -1))


def abandoned_gaps(parts: list[PartInput], vocab: list[str] | None = None) -> list[dict]:
    """The topics of the abandoned problems as gaps, for `practice.suggest` to find bank problems on (the report merges them in `_gaps`);
    their bank_tags are the problem's real tags (None when unknown: practice then reads them from the bank by slug)."""
    return [{"subject": _SUBJECTS.get(p.family, p.family), "topics": [{"topic": t, "bank_tags": problem_bank_tags(p, vocab)} for t in p.topics]}
            for p in _abandoned(parts) if p.topics]


def gap_entries(gaps: list) -> list[tuple[str, str, str]]:
    """(subject, topic, why) of every topic of the given gaps (models or dicts)."""
    return [(subject, name, why) for g in gaps for name, why, subject, _tags in topics_of(g)]


def round_topics(parts: list[PartInput]) -> set[str]:
    """Canonical topics of the round's own problems, the practice fallback for a gap phrase with no recognisable topic."""
    return T.canon([t for p in parts for t in p.topics])


_FAILED = ("partly", "wrong", "not_answered", "not_reached")


def _main_verdict(p: PartInput, merged: dict[str, PartGrade]) -> str | None:
    g = merged.get(p.part_id)
    return next((q.verdict for q in (g.questions if g else []) if q.id == "main"), None)


def map_gap_topics(entries: list[tuple[str, str, str]], parts: list[PartInput], merged: dict[str, PartGrade]) -> list[PartInput | None]:
    """The problem part each (subject, topic, why) gap came from: a part's own topic name, else the graded question topic (and question)
    whose words overlap the gap phrase most (same subject first); None when nothing overlaps (the caller uses the round as a whole).
    The synthesis rewords phrases, so a gap is never looked up by its exact text."""
    slotted = [p for p in parts if p.slug]
    by_name = {n.strip().lower(): p for p in slotted for n in p.topics}
    qs = [(p, q, t) for p in slotted for q in (merged[p.part_id].questions if p.part_id in merged else []) for t in q.topics]
    out: list[PartInput | None] = []
    for subject, topic, why in entries:
        direct = by_name.get(topic.strip().lower())
        if direct is not None:
            out.append(direct)
            continue
        gw = words(f"{topic} {why}")
        pool = [x for x in qs if x[2].subject.strip().lower() == subject.strip().lower()] or qs
        scored = [(len(gw & words(f"{x[2].topic} {x[1].asked}")), x[0]) for x in pool]
        best = max((n for n, _ in scored), default=0)
        out.append(next((p for n, p in scored if best and n == best), None) or (slotted[0] if len(slotted) == 1 else None))
    return out


def source_maps(entries: list[tuple[str, str, str]], parts: list[PartInput], merged: dict[str, PartGrade]) -> dict[str, Source]:
    """Per gap phrase, the `Source` problem for `practice.suggest`. A gap that maps to no problem gets the round as a whole (the union of
    its problems' topics and tags, the main problem's difficulty) with `mapped` False, so it never earns the harder-problem exception."""
    slotted = [p for p in parts if p.slug]
    whole = Source(topics=T.canon([t for p in slotted for t in p.topics]), tags={t for p in slotted for t in (p.reference or {}).get("bank_tags") or []},
                   difficulty=main_difficulty(parts))
    out: dict[str, Source] = {}
    for (_subject, topic, _why), p in zip(entries, map_gap_topics(entries, parts, merged)):
        if p is None:
            out.setdefault(topic, whole)
        else:
            out.setdefault(topic, Source(topics=T.canon(p.topics), tags=set((p.reference or {}).get("bank_tags") or []), slug=p.slug, mapped=True,
                                         difficulty=(p.reference or {}).get("difficulty") or main_difficulty(parts)))
    return out


def main_difficulty(parts: list[PartInput]) -> str | None:
    """The difficulty of the round's first problem, the practice default when nothing more specific is known."""
    return next(((p.reference or {}).get("difficulty") for p in parts if p.slug and (p.reference or {}).get("difficulty")), None)


def inherit_bank_tags(gaps: list[TopicGap], parts: list[PartInput], merged: dict[str, PartGrade], vocab: list[str] | None = None) -> None:
    """A gap topic the synthesis left without bank_tags (None) takes them from the round's graded question topics: the ones whose words
    overlap the gap phrase most (same subject first), else the tags of the main problems' questions; at most 3, most specific first
    (later in the frequency-ordered vocabulary). An explicit [] stays [], and a non-coding subject gets none."""
    rank = {v.lower(): i for i, v in enumerate(vocab or [])}
    qtopics: list[tuple[str, str, list[str]]] = []                 # (subject, topic, tags)
    main_tags: list[str] = []
    for p in parts:
        g = merged.get(p.part_id)
        for q in (g.questions if g else []):
            for t in q.topics:
                if t.bank_tags:
                    qtopics.append((t.subject, t.topic, t.bank_tags))
                    if q.id == "main":
                        main_tags += [x for x in t.bank_tags if x not in main_tags]

    def pick(tags: list[str]) -> list[str]:
        uniq = list(dict.fromkeys(tags))
        return sorted(uniq, key=lambda x: -rank.get(x.lower(), -1))[:3] if rank else uniq[:3]

    for gap in gaps:
        if any(w in gap.subject.lower() for w in NO_PRACTICE_SUBJECTS):
            continue
        for t in gap.topics:
            if t.bank_tags is not None:
                continue
            gw = words(f"{t.topic} {t.why}")
            same = [q for q in qtopics if q[0].strip().lower() == gap.subject.strip().lower()] or qtopics
            scored = [(len(gw & words(q[1])), q) for q in same]
            best = max((s for s, _ in scored), default=0)
            chosen = [q for s, q in scored if best and s == best]
            tags = [x for q in chosen for x in q[2]] if chosen else main_tags
            t.bank_tags = pick(tags) if tags else None


_WEAK = ("partly", "wrong", "not_answered", "not_reached")


def weak_question_gaps(parts: list[PartInput], merged: dict[str, PartGrade]) -> list[TopicGap]:
    """Topic gaps derived from the graded questions that were partly right or worse (deterministic), for a report whose synthesis named none."""
    gaps: dict[str, list[GapTopic]] = {}
    seen: set[str] = set()
    for p in parts:
        g = merged.get(p.part_id)
        for q in (g.questions if g else []):
            if q.verdict not in _WEAK:
                continue
            for t in q.topics:
                if t.topic.strip().lower() in seen:
                    continue
                seen.add(t.topic.strip().lower())
                gaps.setdefault(t.subject or _SUBJECTS.get(p.family, p.family), []).append(GapTopic(topic=t.topic, why=q.gap or "Needs more practice.", bank_tags=t.bank_tags))
    return [TopicGap(subject=k, topics=v) for k, v in gaps.items()]


def _place_retry(gaps: list[dict], p: PartInput, first: dict) -> None:
    """The problem itself as the first practice of `first` (`retry`), and nowhere else in the report: it was already given in the round,
    so it is practice only as a retry, one entry per problem."""
    for g in gaps:
        for t in g["topics"]:
            t["practice"] = [x for x in t["practice"] if x.get("slug") != p.slug]
    first["practice"] = [{"slug": p.slug, "title": p.title, "difficulty": p.reference.get("difficulty"), "retry": True}, *first["practice"]]


def _gaps(synthesis: Synthesis, parts: list[PartInput], practice: dict[str, list[dict]],
          merged: dict[str, PartGrade] | None = None) -> list[dict]:
    """The synthesis' topic gaps, plus the topics of every abandoned problem (merged into the subject's gap, never repeated). A problem the
    candidate abandoned is retried first in its first topic; a main problem graded partly right or worse is retried first in the gap
    that matches it best."""
    gaps = [{"subject": g.subject, "topics": [{"topic": t.topic, "why": t.why, "bank_tags": t.bank_tags, "practice": list(practice.get(t.topic, []))} for t in g.topics]}
            for g in synthesis.topic_gaps]
    known = {t["topic"].strip().lower() for g in gaps for t in g["topics"]}
    retries: list[tuple[PartInput, dict | None]] = []                 # (problem, its gap topic; None = pick the best match below)
    for p in _abandoned(parts):
        subject = _SUBJECTS.get(p.family, p.family.replace("-", " ").capitalize())
        gap = next((g for g in gaps if g["subject"].strip().lower() == subject.lower()), None)
        if gap is None:
            gap = {"subject": subject, "topics": []}
            gaps.append(gap)
        names = p.topics or [p.title]
        why = f"Part of {p.title}, a problem you asked to switch away from."
        for name in names:
            if name.strip().lower() not in known:
                known.add(name.strip().lower())
                gap["topics"].append({"topic": name, "why": why, "bank_tags": list((p.reference or {}).get("bank_tags") or [])[:3] or None,
                                      "practice": list(practice.get(name, []))})
        if p.slug:
            retries.append((p, next(t for g in gaps for t in g["topics"] if t["topic"].strip().lower() == names[0].strip().lower())))
    retries += [(p, None) for p in parts if p.slug and p.ran and not p.swapped and merged and _main_verdict(p, merged) in _FAILED]
    flat = [t for g in gaps for t in g["topics"]]
    owners = map_gap_topics([(g["subject"], t["topic"], t.get("why", "")) for g in gaps for t in g["topics"]], parts, merged or {}) if flat else []
    for p, first in retries:
        if first is None:
            mine = [t for t, o in zip(flat, owners) if o is p]
            if not mine:
                continue
            own = words(" ".join([p.title, *p.topics]))
            first = max(mine, key=lambda t: len(own & words(f"{t['topic']} {t.get('why', '')}")))
        _place_retry(gaps, p, first)
    return gaps


# ---------------------------------------------------------------- build

def build_report(meta: SessionMeta, parts: list[PartInput], merged: dict[str, PartGrade], synthesis: Synthesis, result: ScoreResult,
                 adjustments: list[Adjustment], stats: DeliveryStats, visible: list[VisibleTurn], practice: dict[str, list[dict]],
                 run: dict, previous_areas: dict[str, float] | None, *, shares: dict[str, float] | None = None,
                 hint_turns: list[int] | None = None, disputes: list[dict] | None = None) -> dict:
    """The report document. `shares` are the parts' round shares (parts that ran and were graded); `hint_turns` the interviewer
    turn ids where a hint was given; `disputes` the earlier re-checks of this report."""
    shares = shares or {p.part_id: 1.0 / max(1, len(merged)) for p in parts if p.part_id in merged}
    reason = auto_fail_reason(run)
    gaps = _gaps(synthesis, parts, practice, merged)
    lat = sorted(stats.answer_latencies_s)
    return {
        "meta": _meta(meta, visible),
        "score": result.score, "pass_mark": meta.pass_mark, "outcome": result.outcome, "verdict": result.verdict, "cap": result.cap,
        "practical_score": result.practical, "theory_score": result.theory,
        "base_score": result.base, "bonus_total": result.bonus_total, "penalty_total": result.penalty_total,
        "areas": _areas(parts, merged, shares, meta, previous_areas),
        "adjustments": [{**{k: v for k, v in asdict(a).items() if k != "at"}, "at": to_iso(a.at) or None} for a in adjustments],
        "questions": _questions(parts, merged, run),
        "delivery": {"observations": [o.model_dump() for o in synthesis.delivery],
                     "stats": {"median_answer_latency_s": lat[len(lat) // 2] if lat else None, "slow_starts": stats.slow_starts,
                               "fillers": stats.filler_counts, "long_silences": stats.long_silences,
                               "self_corrections": stats.self_corrections}},
        "conduct": _conduct(run, adjustments, reason, visible),
        "integrity": _integrity(run, adjustments, reason, visible),
        "focus": _focus(synthesis, parts),
        "topic_gaps": gaps,
        "strengths": list(synthesis.strengths), "summary": synthesis.summary,
        "end_questions": synthesis.end_questions.model_dump(),
        "transcript": _transcript(visible, _markers(visible, merged, run, hint_turns or [])),
        "disputes": list(disputes or []),
        "weights_version": EVAL_WEIGHTS_VERSION, "eval_version": EVAL_VERSION,
    }
