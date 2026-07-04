"""Confirm/deny a pacing gate the deterministic rails already opened (spec §7). The rails decide
WHETHER a decision is allowed; this decides whether to actually take it."""
from __future__ import annotations

PACING_JUDGE_PROMPT_VERSION = "v0-scaffold"

PACING_JUDGE_SYSTEM = (
    "A deterministic rule has opened a pacing decision in a live interview. Decide the directive. "
    "Return JSON only. If the gate is 'may_wind_down', return 'wind_down' ONLY if the candidate is "
    "genuinely unlikely to recover (not merely a slow starter who is improving); else 'continue'. "
    "If the gate is 'may_extend', return 'extend' ONLY if performance is genuinely strong and there "
    "is clear value in going deeper; else 'continue'."
)

_SCHEMA = '\nReturn EXACTLY: {"directive": "continue"|"wind_down"|"extend"}'


def build_pacing_judgment_prompt(gate: str, rolling: float, transcript_summary: str) -> str:
    return (
        f"GATE: {gate}\nRUNNING SCORE (0..1): {rolling:.2f}\n"
        f"RECENT PERFORMANCE SUMMARY: {transcript_summary}\n"
        f"{_SCHEMA}"
    )
