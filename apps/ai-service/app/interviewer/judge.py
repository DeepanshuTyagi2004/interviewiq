"""Scores one rehearsal transcript with a model, as a senior interviewer would (prompt in judge_prompt.py)."""
from __future__ import annotations

from typing import Any

from app.interviewer.judge_prompt import DIMENSIONS, judge_messages

__all__ = ["DIMENSIONS", "JUDGE_SCHEMA", "judge_record", "table_row"]

_SCORED = {"type": "object", "properties": {"score": {"type": "integer", "minimum": 1, "maximum": 5}, "evidence": {"type": "string"}},
           "required": ["score", "evidence"]}
JUDGE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {**{d: _SCORED for d in DIMENSIONS}, "overall": {"type": "integer", "minimum": 1, "maximum": 5},
                   "worst_moment": {"type": "object", "properties": {"quote": {"type": "string"}, "why": {"type": "string"}},
                                    "required": ["quote", "why"]},
                   "issues": {"type": "array", "items": {"type": "object", "properties": {
                       "quote": {"type": "string"}, "dimension": {"type": "string", "enum": list(DIMENSIONS)},
                       "severity": {"type": "string", "enum": ["major", "minor"]}, "why": {"type": "string"}},
                       "required": ["quote", "dimension", "severity", "why"]}}},
    "required": [*DIMENSIONS, "overall", "worst_moment", "issues"],
}


async def judge_record(chat, record: dict[str, Any], log: list[str] | None = None) -> dict[str, Any]:
    """The judge's scores for a record (from its event log when given), with the call's usage; raises LLMUnavailable when the model fails."""
    data, usage = await chat.json(judge_messages(record, log), "transcript_judgement", JUDGE_SCHEMA, 16000)   # the budget includes the model's reasoning; 2500 cut replies off mid-JSON
    return {**data, "usage": usage}


def table_row(name: str, result: dict[str, Any]) -> list[Any]:
    """name, the six dimension scores, overall, worst moment (quote and why)."""
    worst = result.get("worst_moment") or {}
    return [name, *[(result.get(d) or {}).get("score") for d in DIMENSIONS], result.get("overall"),
            f"{worst.get('quote', '')} ({worst.get('why', '')})"]
