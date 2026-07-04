"""Grade one answer against the active question's rubric. Interviewer-only; never shown to candidate."""
from __future__ import annotations

import json

GRADE_PROMPT_VERSION = "v0-scaffold-2"

GRADE_SYSTEM = (
    "You grade a candidate's answer against an interviewer rubric. Return JSON only. For each rubric "
    "criterion give a score in [0,1] (1 = matches the strong descriptor, 0 = matches the weak one). "
    "If the candidate's code or diagram is provided, judge it by READING it — correctness, approach, "
    "and complexity — never assume it was run or tested. Also give coherence in [0,1] for how clearly "
    "the answer was expressed. Do not invent criteria."
)

_SCHEMA = '\nReturn EXACTLY: {"criteria": [{"criterion": "<name>", "score": <0..1>}], "coherence": <0..1>}'


def build_grade_prompt(rubric: list[dict], question: str, answer: str, artifact=None) -> str:
    parts = [
        f"RUBRIC:\n{json.dumps(rubric, ensure_ascii=False)}",
        f"QUESTION: {json.dumps(question)}",
        f"SPOKEN ANSWER: {json.dumps(answer)}",
    ]
    if artifact is not None:
        parts.append(
            f"CANDIDATE {artifact.kind.value.upper()} (language={artifact.language or 'n/a'}) — judge by "
            f"reading it, do NOT assume it was executed:\n{artifact.content[:4000]}")
    return "\n".join(parts) + _SCHEMA
