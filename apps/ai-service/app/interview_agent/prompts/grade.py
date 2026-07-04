"""Grade one answer against the active question's rubric. Interviewer-only; never shown to candidate."""
from __future__ import annotations

import json

GRADE_PROMPT_VERSION = "v0-scaffold"

GRADE_SYSTEM = (
    "You grade a candidate's answer against an interviewer rubric. Return JSON only. For each rubric "
    "criterion give a score in [0,1] (1 = matches the strong descriptor, 0 = matches the weak one). "
    "Also give coherence in [0,1] for how clearly the answer was expressed. Do not invent criteria."
)

_SCHEMA = '\nReturn EXACTLY: {"criteria": [{"criterion": "<name>", "score": <0..1>}], "coherence": <0..1>}'


def build_grade_prompt(rubric: list[dict], question: str, answer: str) -> str:
    return (
        f"RUBRIC:\n{json.dumps(rubric, ensure_ascii=False)}\n"
        f"QUESTION: {json.dumps(question)}\n"
        f"ANSWER: {json.dumps(answer)}\n"
        f"{_SCHEMA}"
    )
