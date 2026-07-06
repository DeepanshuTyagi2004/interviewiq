"""Classify a persona's FIRST/DISPLAY name by gender, for Aura-2 TTS voice selection (Task 5). Used
ONLY as a fallback in voice.select_voice when a cached InterviewPlan predates persona.gender
(Task 4) — new plans carry the field directly and never reach this prompt."""
from __future__ import annotations

import json

GENDER_CLASSIFY_PROMPT_VERSION = "v0-scaffold"

GENDER_CLASSIFY_SYSTEM = (
    "You classify a person's FIRST or DISPLAY name by likely gender, solely to pick a text-to-speech "
    "voice for a mock interview. Return JSON only.\n"
    "Genders: 'male', 'female', 'neutral' — use 'neutral' for unisex or ambiguous names. Always "
    "return exactly one of the three values; never add commentary or hedge."
)

_SCHEMA = '\nReturn EXACTLY: {"gender": "male"|"female"|"neutral"}'


def build_gender_classify_prompt(name: str) -> str:
    return f"NAME: {json.dumps(name)}\n{_SCHEMA}"
