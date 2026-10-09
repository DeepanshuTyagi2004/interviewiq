"""The interview plan built from a blueprint (spec §4), and the candidate-safe problem payload (spec
§6.3): the statement and two examples under a generic label. Never names, topics or difficulty."""
from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Literal

ItemKind = Literal["phase", "slot", "filler"]
ItemStatus = Literal["pending", "active", "done", "skipped", "swapped"]
PROTECTED_PHASES = frozenset({"candidate_questions", "wrap_up"})
MIN_PHASE_SECONDS = 60


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


def _ordered(slots: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
    return sorted((s for s in slots if s.get("kind") == kind), key=lambda s: s.get("order", 0))


def build_items(blueprint: dict[str, Any]) -> list[Item]:
    items: list[Item] = []
    for phase in blueprint.get("arc", []):
        name = phase["phase"]
        if name == "core":
            for slot in _ordered(blueprint.get("slots", []), "core"):
                items.append(Item(slot["slot_id"], "slot", "core", int(slot["timebox_mins"]) * 60, slot_id=slot["slot_id"]))
        else:
            items.append(Item(name, "phase", name, max(MIN_PHASE_SECONDS, int(phase.get("timebox_mins") or 1) * 60)))
    return items


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
