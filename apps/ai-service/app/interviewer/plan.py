"""The interview plan built from a blueprint (spec §4), and the candidate-safe problem payload (spec
§6.3): the statement and two examples under a generic label. Never names, topics or difficulty."""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Literal

from app.blueprint.vocabulary import family, slot_round_type

ItemKind = Literal["phase", "slot", "filler"]
ItemStatus = Literal["pending", "active", "done", "skipped", "swapped"]
PROTECTED_PHASES = frozenset({"candidate_questions", "deep_dive", "wrap_up"})
MIN_PHASE_SECONDS = 60
# Candidate exchanges a phase needs before the interviewer may leave it early (its time being up always wins). A real
# interviewer does not skip the background questions because the candidate says "ready".
MIN_TURNS: dict[str, int] = {"small_talk": 1, "framing": 1, "deep_dive": 3, "candidate_questions": 1}
# The conversation before the coding (greeting, small talk, framing, the intro) is counted as one block: the talker is not
# always exact about which of these it is in, so what is required is enough real exchanges across them before the problem.
BACKGROUND_PHASES = frozenset({"greeting", "small_talk", "framing", "candidate_intro"})
MIN_BACKGROUND_TURNS = 5


@dataclass
class Item:
    item_id: str
    kind: ItemKind
    phase: str
    max_seconds: int
    slot_id: str | None = None
    status: ItemStatus = "pending"
    started_at: float | None = None
    ended_at: float | None = None
    ended_by: str | None = None
    hint_step: int = 0
    filler: dict[str, str] | None = None
    turns: int = 0                      # candidate exchanges while this item was active


def _ordered(slots: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
    return sorted((s for s in slots if s.get("kind") == kind), key=lambda s: s.get("order", 0))


def build_items(blueprint: dict[str, Any]) -> list[Item]:
    items: list[Item] = []
    deep_dive = int((blueprint.get("round") or {}).get("deep_dive_mins") or 0)
    for phase in blueprint.get("arc", []):
        name = phase["phase"]
        if name == "core":
            for slot in _ordered(blueprint.get("slots", []), "core"):
                items.append(Item(slot["slot_id"], "slot", "core", int(slot["timebox_mins"]) * 60, slot_id=slot["slot_id"]))
            if deep_dive > 0:
                # The blueprint sets time aside for questions on the candidate's projects and the round's other topics
                # inside the core's minutes. It is a conversation: its own item, so the room goes back to full width.
                items.append(Item("deep_dive", "phase", "deep_dive", deep_dive * 60))
        else:
            items.append(Item(name, "phase", name, max(MIN_PHASE_SECONDS, int(phase.get("timebox_mins") or 1) * 60)))
    return items


def layout_for(blueprint: dict[str, Any], item: Item) -> str:
    """`work` while the candidate is on a coding, low-level design or system design problem (they need the problem
    and the editor or board), `talk` for everything else: greetings, resume and profile questions, behavioural
    questions, their questions for the interviewer and the closing."""
    if item.kind != "slot":
        return "talk"
    slot = slot_by_id(blueprint, item.slot_id) or {}
    round_type = (slot.get("problem") or {}).get("round_type") or (blueprint.get("round") or {}).get("type") or "dsa"
    return "talk" if family(slot_round_type(round_type, item.slot_id or "")) == "behavioural" else "work"


def reserve_slots(blueprint: dict[str, Any]) -> list[dict[str, Any]]:
    return _ordered(blueprint.get("slots", []), "reserve")


def wire_ids(blueprint: dict[str, Any]) -> dict[str, str]:
    """slot_id -> the id the candidate's browser sees: the slot's kind and its position among slots of that kind.
    Blueprint ids can carry a word (`reserve-harder`, `reserve-alternate`) that would show in the wire and the DOM."""
    ids: dict[str, str] = {}
    for kind in ("core", "reserve"):
        for n, slot in enumerate(_ordered(blueprint.get("slots", []), kind), start=1):
            ids[slot["slot_id"]] = f"{kind}-{n}"
    return ids


def slot_by_id(blueprint: dict[str, Any], slot_id: str | None) -> dict[str, Any] | None:
    return next((s for s in blueprint.get("slots", []) if s.get("slot_id") == slot_id), None) if slot_id else None


def round_seconds(blueprint: dict[str, Any], context: dict[str, Any]) -> int:
    minutes = ((context.get("round") or {}).get("duration_mins") or (blueprint.get("round") or {}).get("duration_mins")
               or sum(int(p.get("timebox_mins") or 0) for p in blueprint.get("arc", [])))
    return int(minutes) * 60


def _literal(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def format_args(args: dict[str, Any]) -> str:
    return "\n".join(f"{name} = {_literal(value)}" for name, value in args.items())


def _content(slot: dict[str, Any] | None) -> dict[str, Any]:
    return ((slot or {}).get("problem") or {}).get("content") or {}


def problem_payload(slot: dict[str, Any], label: str, item_id: str | None = None) -> dict[str, Any]:
    content = _content(slot)
    statement = (content.get("statement") or content.get("question") or (slot.get("ask") or {}).get("opening") or "").strip()
    examples = []
    for ex in (content.get("examples") or [])[:2]:
        example = {"input": format_args(ex.get("args") or {}), "output": _literal(ex.get("expected"))}
        if ex.get("explanation"):
            example["explanation"] = str(ex["explanation"])[:2000]
        examples.append(example)
    return {"type": "panel.show_problem", "item_id": item_id or slot["slot_id"], "label": label,
            "kind": "problem" if examples else "question", "statement": statement[:20000], "examples": examples}


def reveal_text(slot: dict[str, Any] | None, kind: str) -> str | None:
    """Exactly what the problem says: constraints, or the input/output format. Shown only when asked."""
    content = _content(slot)
    if kind == "constraints":
        return "\n".join(str(c) for c in content.get("constraints") or []) or None
    if kind == "format":
        parts = [f"Input: {content['input_format']}" if content.get("input_format") else "",
                 f"Output: {content['output_format']}" if content.get("output_format") else ""]
        return "\n".join(p for p in parts if p) or None
    return None


def intro_probes(personal: dict[str, Any]) -> list[dict[str, Any]]:
    """The resume probe the introduction may use: the first of two or more. With a single probe it is kept for the deep dive."""
    probes = list(personal.get("resume_probes") or [])
    return probes[:1] if len(probes) >= 2 else []


def deep_dive_probes(personal: dict[str, Any]) -> list[dict[str, Any]]:
    """The resume probes left for the deep dive, so it never re-asks what the introduction already covered."""
    probes = list(personal.get("resume_probes") or [])
    return probes[1:] if len(probes) >= 2 else probes


def opening_hint(blueprint: dict[str, Any], phase: str) -> str | None:
    """What to say first when the interview moves on to this part, so the move is a question and not an announcement."""
    personal = blueprint.get("personalization") or {}
    if phase == "framing":
        return "say how the round will run (from the outline), then ask for a short introduction of their background."
    if phase == "candidate_intro":
        return "ask for a short introduction, then what they are working on now."
    if phase == "deep_dive":
        probe = next((p.get("prompt") for p in deep_dive_probes(personal) if p.get("prompt")), None)
        return probe or "ask about a project from their resume, then a fundamentals question."
    if phase == "candidate_questions":
        return "thank them and invite their questions about the team and the work."
    if phase == "wrap_up":
        return (blueprint.get("persona") or {}).get("closing") or "thank them and say what happens next."
    return None
