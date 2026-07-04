"""Derive a small question ladder on a NEW in-scope topic mid-interview (spec §8.2), grounded in the
round + brief + JD. Output matches one QuestionLadder so it can be scored like any other."""
from __future__ import annotations

import json

DERIVE_PROMPT_VERSION = "v0-scaffold"

DERIVE_SYSTEM = (
    "Generate ONE question ladder on the requested topic for a live interview, calibrated to the "
    "round and grounded in the brief/JD. Return JSON only, matching the ladder shape: base_prompt, "
    "follow_ups (1-2, escalating), hints (1-2), rubric (2-3 weighted criteria). Keep it to material "
    "answerable in a few minutes."
)

_SCHEMA = (
    '\nReturn EXACTLY: {"base_prompt": "<question>", "follow_ups": ["..."], "hints": ["..."], '
    '"rubric": [{"criterion": "<name>", "weight": <number>}]}'
)


def build_derive_prompt(round_type: str, topic: str, brief: str, jd: str) -> str:
    return (
        f"ROUND: {round_type}\nTOPIC REQUESTED: {topic}\n"
        f"BRIEF (context): {brief[:1500]}\nJD (context): {jd[:1000]}\n"
        f"{_SCHEMA}"
    )
