"""Classify ONE candidate turn spoken during the OPENING of a live interview — before the first real
question has been asked. The opening loop (session.py) uses this to decide whether to keep answering
the candidate's questions or move on to Q1; it is deliberately tiny (no topic/scope extraction, no
scoring) because the opening is never graded."""
from __future__ import annotations

import json

OPENING_CLASSIFY_PROMPT_VERSION = "v0-scaffold"

OPENING_CLASSIFY_SYSTEM = (
    "You label ONE candidate turn spoken during the OPENING of a live interview, before the first "
    "question has been asked. Return JSON only.\n"
    "Intents: 'question' — the candidate is asking something (about the format, logistics, what to "
    "expect, or anything else) and expects a reply before starting; 'ready' — they are not asking "
    "anything and are effectively ready to begin (a greeting, small talk reply, or explicit "
    "readiness)."
)

_SCHEMA = '\nReturn EXACTLY: {"intent": "ready"|"question"}'


def build_opening_classify_prompt(last_text: str) -> str:
    return f"CANDIDATE TURN: {json.dumps(last_text)}\n{_SCHEMA}"
