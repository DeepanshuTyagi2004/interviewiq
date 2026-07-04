"""Classify a candidate turn into a TurnClass and, for pivots, extract the requested topic + scope."""
from __future__ import annotations

import json

CLASSIFY_PROMPT_VERSION = "v0-scaffold"

CLASSIFY_SYSTEM = (
    "You label ONE candidate turn in a live technical interview. Return JSON only.\n"
    "Classes: answer (they attempt the question), clarify (they ask a clarifying question about the "
    "current question), off_topic (unrelated tangent), challenge (they push back on you/the process), "
    "distress (nervous, stuck, apologetic), idk_silence (they don't know / say nothing), "
    "pivot_request (they ask to switch to a DIFFERENT topic or question).\n"
    "For pivot_request also return requested_topic (the topic they want, or null if unspecified) and "
    "topic_scope: 'in' if it still belongs to this round, 'out' if it belongs to a different kind of "
    "round, 'unclear' otherwise. Use the round context provided."
)

_SCHEMA = (
    '\nReturn EXACTLY: {"turn_class": "<one class>", "requested_topic": <string|null>, '
    '"topic_scope": "in"|"out"|"unclear"}'
)


def build_classify_prompt(round_context: str, active_item_summary: str, last_text: str) -> str:
    return (
        f"ROUND CONTEXT: {round_context}\n"
        f"CURRENT QUESTION: {active_item_summary}\n"
        f"CANDIDATE TURN: {json.dumps(last_text)}\n"
        f"{_SCHEMA}"
    )
