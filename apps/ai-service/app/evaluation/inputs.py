"""Evidence assembly for the post-interview report (spec §7.2, §7.4, §7.6, §8.1, §11.3).

Turns a finished live round's stored data (blueprint, `live_runs` doc, `live_turns`, `live_evidence`) into what the
LLM graders and the score arithmetic consume: the candidate-visible transcript, one `PartInput` per part of the round,
delivery statistics read from words and timing, and the `AdjustmentInputs` of `score.py`. Pure: no I/O, no LLM.

Part model
- A problem slot is a part of its family (the slot's own round type; a `culture-` slot is behavioural). In a
  hiring-manager round the deep dive is a part of the `hiring-manager` family; elsewhere it is `knowledge`.
- `deep_dive` phase item -> the round questions and resume probes (family `knowledge`), `candidate_questions` phase
  item -> part `end_questions` (never weighted: the caller gives it no share).
- Greeting, small talk, framing, intro, wrap-up, thread and filler items are not parts. A thread's turns belong to
  its parent's part.
- A part ran unless the interviewer's or the plan's choice left it out (skipped, an unreached bonus problem) or, for
  the two phase parts, nothing was said in it. A core problem the candidate did not reach (still pending, not a bonus)
  ran: the graders score it `not_reached`.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

from app.blueprint.vocabulary import family as round_family
from app.blueprint.vocabulary import slot_round_type
from app.evaluation.models import Events
from app.evaluation.score import AdjustmentInputs
from app.evaluation.weights import FAMILIES

END_QUESTIONS = "end_questions"
SLOW_START_S = 6.0
LONG_SILENCE_S = 90.0
WORDS_PER_SECOND = 2.5          # about 150 words a minute: how long a spoken text is taken to last (audio is not stored)
NOT_GIVEN = "not given by the interviewer"
NOT_COVERED = "not covered in this round"
ROUND_ENDED_BY_PERSON = frozenset({"candidate_ended", "ended_by_interviewer"})
_CODE_FAMILIES = frozenset({"dsa", "online-assessment", "lld"})


# ---------------------------------------------------------------- transcript

@dataclass
class VisibleTurn:
    turn_id: int
    speaker: Literal["interviewer", "candidate"]
    text: str
    at: str
    cut_off: bool
    item_id: str | None = None      # the part the turn was said in (a thread's turns belong to its parent part)


def _iso(at: Any) -> str:
    if isinstance(at, (int, float)) and not isinstance(at, bool):
        try:
            return datetime.fromtimestamp(float(at), timezone.utc).isoformat()
        except (OverflowError, OSError, ValueError):
            return str(at)
    return "" if at is None else str(at)


def _squash(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def visible_transcript(turns: list[dict]) -> list[VisibleTurn]:
    """What the candidate could have heard or said: no interviewer turn that never played (`spoken` is False), no sentence the
    guard dropped (`blocked`), the `heard` part of an interrupted interviewer turn when it was recorded. Orders, tool calls
    and briefs are never part of a turn's text and are never read here."""
    out: list[VisibleTurn] = []
    for t in sorted(turns, key=lambda d: int(d.get("seq") or 0)):
        speaker = t.get("speaker")
        if speaker not in ("interviewer", "candidate"):
            continue
        text = t.get("text") or ""
        cut = bool(t.get("interrupted"))
        if speaker == "interviewer":
            if t.get("spoken") is False:
                continue
            for b in t.get("blocked") or []:
                sentence = (b.get("sentence") if isinstance(b, dict) else str(b)) or ""
                if sentence:
                    text = text.replace(sentence, " ")
            if (t.get("cut_off") or t.get("interrupted")) and (t.get("heard") or "").strip():
                text, cut = t["heard"], True
            cut = cut or bool(t.get("cut_off"))
        text = _squash(text)
        if not text:
            continue
        out.append(VisibleTurn(int(t["seq"]), speaker, text, _iso(t.get("at")), cut, t.get("item_id")))
    return out


# ---------------------------------------------------------------- parts

@dataclass
class PartInput:
    part_id: str
    family: str
    title: str
    planned_min: float | None
    ran: bool
    excluded_reason: str | None
    ended_by: str | None
    turns: list[VisibleTurn]
    reference: dict
    code: dict | None
    board: str | None
    evidence_notes: list[dict]
    hint_steps: list[int]
    is_bonus: bool
    swapped: bool = False           # the candidate asked to switch away from this problem and was given another (owner decision 2026-10-18)
    slug: str | None = None         # the problem's bank slug (slot parts only)
    topics: list[str] = field(default_factory=list)     # the problem's own topics / patterns (slot parts only)


def _slot(blueprint: dict, slot_id: str | None) -> dict | None:
    return next((s for s in blueprint.get("slots") or [] if s.get("slot_id") == slot_id), None) if slot_id else None


def _slot_family(blueprint: dict, slot: dict) -> str:
    round_type = (blueprint.get("round") or {}).get("type") or "dsa"
    rt = slot_round_type((slot.get("problem") or {}).get("round_type") or round_type, slot.get("slot_id") or "")
    return rt if rt in FAMILIES else round_family(rt)


def _slot_reference(slot: dict) -> dict:
    problem = slot.get("problem") or {}
    return {"title": problem.get("title"), "difficulty": problem.get("difficulty"), "content": problem.get("content") or {},
            "answer_key": (slot.get("answer_key") or {}).get("key"), "expectations": slot.get("expectations") or {},
            "evaluation_signals": slot.get("evaluation_signals") or [], "hint_ladder": slot.get("hint_ladder") or [],
            "bank_tags": [str(t).strip() for key in ("topic_tags", "patterns_tested") for t in problem.get(key) or [] if str(t).strip()]}


def _slot_topics(slot: dict) -> list[str]:
    problem = slot.get("problem") or {}
    content = problem.get("content") or {}
    out: list[str] = []
    for src in (problem, content):
        for key in ("topic_tags", "patterns_tested", "patterns", "components_tested"):
            for t in src.get(key) or []:
                t = str(t).strip()
                if t and t.lower() not in {x.lower() for x in out}:
                    out.append(t)
    return out


def _deep_dive_reference(blueprint: dict) -> dict:
    personal = blueprint.get("personalization") or {}
    questions = [q if isinstance(q, dict) else {"prompt": str(q)} for q in personal.get("round_questions") or [] if q]
    return {"round_questions": questions, "resume_probes": [p for p in personal.get("resume_probes") or [] if isinstance(p, dict)],
            "level_expectations": personal.get("level_expectations", "")}


def _arc_minutes(blueprint: dict, phase: str) -> float | None:
    p = next((p for p in blueprint.get("arc") or [] if p.get("phase") == phase), None)
    return float(p["timebox_mins"]) if p and p.get("timebox_mins") is not None else None


def build_parts(blueprint: dict, run: dict, turns: list[VisibleTurn], evidence: list[dict]) -> list[PartInput]:
    """One part per checkpoint item that is a part of the round (see the module docstring), in plan order."""
    items = list((run.get("checkpoint") or {}).get("items") or [])
    round_type = (blueprint.get("round") or {}).get("type") or "dsa"
    by_id = {i["item_id"]: i for i in items}

    def owner(item_id: str | None) -> str | None:
        item = by_id.get(item_id or "")
        seen = 0
        while item is not None and item.get("kind") == "thread" and item.get("parent") and seen < 5:
            item, seen = by_id.get(item["parent"]), seen + 1
        return item["item_id"] if item else None

    # A candidate turn belongs to the item they were RESPONDING TO: the item of the last interviewer turn that was played to them, not the
    # conductor's item at the moment it was recorded (the conductor may already have moved on to an item whose first turn never played).
    owned: dict[str, list[VisibleTurn]] = {}
    heard_item: str | None = None
    for t in turns:
        if t.speaker == "interviewer":
            heard_item = t.item_id or heard_item
            item_id = t.item_id
        else:
            item_id = heard_item or t.item_id
        if (o := owner(item_id)) is not None:
            owned.setdefault(o, []).append(t)
    notes: dict[str, list[dict]] = {}
    for e in evidence:
        if (o := owner(e.get("item_id"))) is not None:
            notes.setdefault(o, []).append({"item_id": e.get("item_id"), "signal": e.get("signal"),
                                            "observations": list(e.get("observations") or [])})

    parts: list[PartInput] = []
    for item in items:
        kind, phase, iid = item.get("kind"), item.get("phase"), item["item_id"]
        status = item.get("status")
        mine = owned.get(iid, [])
        code = board = None
        hint_steps: list[int] = []
        swapped, slug, topics = False, None, []
        if kind == "slot":
            slot = _slot(blueprint, item.get("slot_id"))
            if slot is None:
                continue
            fam = _slot_family(blueprint, slot)
            title, planned, reference = (slot.get("problem") or {}).get("title") or iid, float(slot["timebox_mins"]), _slot_reference(slot)
            bonus = bool(item.get("bonus") or slot.get("bonus"))
            swapped = status == "swapped"
            slug, topics = (slot.get("problem") or {}).get("slug"), _slot_topics(slot)
            if fam in _CODE_FAMILIES:
                code = {"language": item.get("code_language") or "", "text": item.get("code_final") or ""}
            board = item.get("board_final") or None
            hint_steps = list(range(1, int(item.get("hint_step") or 0) + 1))
            if status in ("done", "active"):
                ran, why = True, None
            elif status == "pending" and not bonus:
                ran, why = True, None                       # not reached at the candidate's own pace: graded `not_reached`
            elif status == "swapped":
                ran, why = True, None                       # an abandoned problem is graded even when nothing was said on it: "not answered"
            elif (status == "skipped" and not bonus and run.get("end_reason") in ROUND_ENDED_BY_PERSON
                  and not str(item.get("ended_by") or "").startswith(("interviewer", "passed over", "asked_for_another"))):
                ran, why = True, None                       # the round was ended on it (candidate left, conduct, integrity): graded `not_reached`
            else:
                ran, why = False, NOT_GIVEN
        elif phase == "deep_dive":
            fam = "hiring-manager" if round_type == "hiring-manager" else "knowledge"
            title, bonus, reference = "Projects and fundamentals", False, _deep_dive_reference(blueprint)
            dd = (blueprint.get("round") or {}).get("deep_dive_mins")
            planned = float(dd) if dd else None
            ran = status in ("done", "active") and any(t.speaker == "candidate" for t in mine)
            why = None if ran else NOT_COVERED
        elif phase == "candidate_questions":
            fam, title, bonus, reference = END_QUESTIONS, "Your questions", False, {}
            planned = _arc_minutes(blueprint, "candidate_questions")
            ran = status in ("done", "active") and any(t.speaker == "candidate" for t in mine)
            why = None if ran else NOT_COVERED
        else:
            continue
        parts.append(PartInput(iid, fam, title, planned, ran, why, item.get("ended_by"), mine, reference, code, board,
                               notes.get(iid, []), hint_steps, bonus, swapped, slug, topics))
    return parts


# ---------------------------------------------------------------- delivery (spec §7.6)

@dataclass
class DeliveryStats:
    answer_latencies_s: list[float]
    slow_starts: list[int]                  # turn ids of candidate answers that began SLOW_START_S or more after the question
    filler_counts: dict[str, int]           # only the fillers that occurred; a lower bound, as speech-to-text drops some
    long_silences: list[dict]               # {item_id, from_turn_id, at, seconds}
    self_corrections: int


_FILLERS: dict[str, re.Pattern[str]] = {
    "um": re.compile(r"\bu+m+\b", re.IGNORECASE),
    "uh": re.compile(r"\bu+h+\b", re.IGNORECASE),
    # "like" only as a filler: next to a comma ("it's, like, a map") or after "was"/"is" ("he was like"), never "I like" or "like a map"
    "like": re.compile(r",\s*like\b|\blike\s*,|\b(?:was|is|were|am|i'm|it's|he's|she's)\s+like\b", re.IGNORECASE),
    "basically": re.compile(r"\bbasically\b", re.IGNORECASE),
    "actually": re.compile(r"\bactually\b", re.IGNORECASE),
    "you know": re.compile(r"\byou know\b", re.IGNORECASE),
    "so yeah": re.compile(r"\bso yeah\b", re.IGNORECASE),
}
_SELF_CORRECTION = re.compile(r"\b(?:i mean|no wait|wait,? no|scratch that|let me rephrase|let me correct|sorry,? (?:i|let)|actually,? no|correction)\b", re.IGNORECASE)


def _words(text: str) -> int:
    return len(text.split())


def _num(x: Any) -> float | None:
    return float(x) if isinstance(x, (int, float)) and not isinstance(x, bool) else None


def delivery_stats(turns: list[dict], visible: list[VisibleTurn], coding_items: set[str] | None = None,
                   parents: dict[str, str] | None = None) -> DeliveryStats:
    """Delivery from words and timing only (audio is not stored).

    Time to start an answer: the candidate turn's `at` is when their turn closed, so the start is estimated as
    `at` - the endpointing wait (stored on the interviewer's reply that followed) - the answer's spoken length (words at 150 a
    minute), measured from where the interviewer's previous spoken turn is estimated to have ended (its `at` plus its own spoken
    length). Answers shorter than 4 words (a "yes") are not measured. `coding_items` are the item ids of coding parts: a long silence
    is more than 90 s inside one of them with no candidate turn (without it no silence is reported); `parents` maps a thread item id
    to its parent part, so a turn said in a thread counts for the part. Only the first candidate turn after an interviewer turn is
    timed, and none said while a coding part is open (typing and thinking aloud there are not a slow start)."""
    parents = parents or {}
    coding_items = coding_items or set()
    raw = sorted((t for t in turns if t.get("speaker") in ("interviewer", "candidate")), key=lambda d: int(d.get("seq") or 0))
    shown = {v.turn_id: v for v in visible}
    latencies: list[float] = []
    slow: list[int] = []
    for n, t in enumerate(raw):
        v = shown.get(int(t["seq"]))
        if t["speaker"] != "candidate" or v is None or _words(v.text) < 4:
            continue
        if n > 0 and raw[n - 1]["speaker"] == "candidate":
            continue                                        # a continuation: the question was answered by the turn before
        if parents.get(t.get("item_id"), t.get("item_id")) in coding_items:
            continue
        prev = next((p for p in reversed(raw[:n]) if p["speaker"] == "interviewer" and int(p["seq"]) in shown), None)
        nxt = next((x for x in raw[n + 1:] if x["speaker"] == "interviewer"), None)
        if prev is None or _num(prev.get("at")) is None or _num(t.get("at")) is None:
            continue
        spoke_end = float(t["at"]) - (_num((nxt or {}).get("endpointing_ms")) or 0.0) / 1000.0
        asked_end = float(prev["at"]) + _words(shown[int(prev["seq"])].text) / WORDS_PER_SECOND
        latency = round(max(0.0, spoke_end - _words(v.text) / WORDS_PER_SECOND - asked_end), 2)
        latencies.append(latency)
        if latency >= SLOW_START_S:
            slow.append(v.turn_id)

    fillers: dict[str, int] = {}
    corrections = 0
    for v in visible:
        if v.speaker != "candidate":
            continue
        for name, pattern in _FILLERS.items():
            if n := len(pattern.findall(v.text)):
                fillers[name] = fillers.get(name, 0) + n
        corrections += len(_SELF_CORRECTION.findall(v.text))

    silences: list[dict] = []
    for item_id in sorted(coding_items):
        inside = [t for t in raw if parents.get(t.get("item_id"), t.get("item_id")) == item_id and _num(t.get("at")) is not None]
        if not inside:
            continue
        marks = [(float(inside[0]["at"]), int(inside[0]["seq"])),
                 *[(float(t["at"]), int(t["seq"])) for t in inside if t["speaker"] == "candidate"]]
        end = float(inside[-1]["at"])
        for (a, seq), b in zip(marks, [m[0] for m in marks[1:]] + [end]):
            if b - a > LONG_SILENCE_S:
                silences.append({"item_id": item_id, "from_turn_id": seq, "at": a, "seconds": round(b - a, 1)})
    return DeliveryStats(latencies, slow, fillers, silences, corrections)


# ---------------------------------------------------------------- adjustments

def _events(value: Any) -> Events | None:
    if value is None:
        return None
    return value if isinstance(value, Events) else Events.model_validate(value)


def _abuse(cp: dict) -> list[dict]:
    """The conduct ledger's first abusive entry (abuse ends the round at once, so there is at most one that counts)."""
    for c in cp.get("conduct") or []:
        if c.get("kind") == "abusive":
            tid = c.get("turn_id")
            return [{"turn_id": int(tid) if str(tid).isdigit() else None, "at": c.get("at")}]
    return []


def adjustment_inputs(run: dict, parts: list[PartInput], merged_events: dict) -> AdjustmentInputs:
    """The inputs of `score.adjustments` from the run's checkpoint, the parts and the graders' merged events.

    `merged_events` (built by the caller): `{part_id: Events | dict}` for each part graded, plus the round-level keys
    `beyond_level: bool`, `bonus_solved: bool` and `end_questions_bonus: float` (all optional). Only parts that ran contribute:
    their hint steps (steps >= 1, keyed by part id), their bug events, and their `beyond_level` / `bonus_solved` flags (OR-ed
    with the round-level ones). Conduct warnings are the `warnings_given` entries about "conduct" (turn id = the interviewer
    turn that said it); the proctor ledger passes through as {kind, weight, at}; away overstays are the ledger's `away_overstay`
    entries (the checkpoint's `away` is only the current episode: it is cleared when the person returns or the overstay is recorded)."""
    cp = run.get("checkpoint") or {}
    ran = [p for p in parts if p.ran]
    hints = {p.part_id: [s for s in p.hint_steps if s >= 1] for p in ran if any(s >= 1 for s in p.hint_steps)}
    events = [(p, _events(merged_events.get(p.part_id))) for p in ran]
    events = [(p, e) for p, e in events if e is not None]
    proctor = [e for e in cp.get("proctor") or []]
    return AdjustmentInputs(
        hint_steps_by_problem=hints,
        pointed_out_bugs=sum(sum(1 for q in e.pointed_out_bugs if "?" not in q.text and q.turn_id not in {h.turn_id for h in e.help_requests if h.kind != "help"})
                                for _, e in events),
        self_found_bugs=sum(len(e.self_found_bugs) for _, e in events),
        change_requests=sum(int(v) for v in (cp.get("change_requests") or {}).values()),
        change_granted=bool(cp.get("change_given")) or int(cp.get("changes_round") or 0) > 0,
        beyond_level=bool(merged_events.get("beyond_level")) or any(e.beyond_level for _, e in events),
        bonus_solved=bool(merged_events.get("bonus_solved")) or any(e.bonus_solved for _, e in events),
        end_questions_bonus=float(merged_events.get("end_questions_bonus") or 0.0),
        conduct_warnings=[{"kind": "final_warning" if w.get("kind") == "final_warning" else "warning",
                           "turn_id": w.get("turn"), "at": w.get("at")}
                          for w in cp.get("warnings_given") or [] if w.get("about") == "conduct"],
        proctor=[{"kind": e.get("kind"), "weight": e.get("weight", 1), "at": e.get("at")} for e in proctor],
        pastes=[{"at": p.get("at"), "item_id": p.get("item_id"), "turn_id": None} for p in cp.get("pastes") or []],
        away_overstays=[{"at": e.get("at")} for e in proctor if e.get("kind") == "away_overstay"],
        abuse=_abuse(cp),
    )
