"""Extension-reserve prompt (Pipeline 1 → Pipeline 2). Generates a few EXTRA hard ladders used ONLY
when the live agent extends a strong candidate toward the time ceiling (spec §7). Same ladder shape
as ladder.py. v1 DRAFT — product IP; bump RESERVE_PROMPT_VERSION on change."""
from __future__ import annotations

import json

from app.interview_prep.prompts.style import PLATFORM_CONTEXT, SPOKEN_STYLE

RESERVE_PROMPT_VERSION = "v1"

RESERVE_SYSTEM = (
    "Produce a small set of EXTRA, HARDER question ladders for a strong candidate who finishes early "
    "and earns extra time. Each is a fresh, harder question in this round's domain — NOT a repeat of "
    "the main questions. Same shape as a normal ladder (base_prompt, follow_ups easiest→hardest, "
    "hints subtle→explicit, weighted rubric, timebox). Calibrate to the company/role/level.\n"
    "\n"
    + SPOKEN_STYLE
    + PLATFORM_CONTEXT
    + '\nReturn VALID JSON ONLY: {"ladders": [ { ...ladder... } ]}'
)


def build_reserve_prompt(grounding: dict, n: int = 2) -> str:
    return (
        f"Produce {n} harder bonus ladders for this round, grounded in the context. Do not duplicate "
        f"typical starter questions.\n\nGROUNDING:\n{json.dumps(grounding, ensure_ascii=False, indent=2)}\n"
    )
