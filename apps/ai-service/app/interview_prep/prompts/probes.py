"""Candidate-probe prompt: build targeted probes grounded in the candidate's own profile
(projects, experience, skills) — each probe says what it tests and what profile signal it is
grounded in.

v1 DRAFT — product IP. Reviewed/tuned by a human before production. Bump PROBES_PROMPT_VERSION on
any change so provenance tracks which prompt produced a plan.
"""
from __future__ import annotations

import json

from app.interview_prep.prompts.style import PLATFORM_CONTEXT, SPOKEN_STYLE

PROBES_PROMPT_VERSION = "v2"

# The candidate-probe system prompt. The LLM client folds this into the user turn.
PROBES_SYSTEM = (
    "You design CANDIDATE PROBES — the questions an interviewer uses to dig into what THIS candidate "
    "actually did, so the conversation is about their real work rather than generic trivia.\n"
    "\n"
    "Read the candidate profile and design probes that:\n"
    "- Anchor to a specific, named signal in the profile — a particular project, an experience "
    "bullet, or a claimed skill. Reference it concretely (e.g. 'the caching layer in <project>'), "
    "not vaguely ('your projects'). Put that signal in grounded_in.\n"
    "- Invite depth: get at decisions, trade-offs, ownership, what broke and what they'd do "
    "differently — the things that separate someone who built it from someone who watched. Each "
    "probe opens with ONE question, though (see SPEAKING STYLE); don't pack that whole list into a "
    "single sentence.\n"
    "- State what_it_tests: the competency or behaviour the probe surfaces (e.g. 'system trade-off "
    "reasoning', 'depth of ownership', 'debugging under ambiguity').\n"
    "- Stay calibrated to the role/level in the grounding.\n"
    "\n"
    "If the profile is thin or empty, fall back to a few probes tied to the role and the JD's tech "
    "stack, and say so in grounded_in (e.g. 'no project data — grounded in JD tech stack'). Never "
    "fabricate projects or experience the candidate did not list.\n"
    "\n"
    "These are interviewer prompts — describe what to ask and why; never grade, score, or rank the "
    "candidate.\n"
    "\n"
    + SPOKEN_STYLE
    + PLATFORM_CONTEXT
    + "\n"
    "Respond with VALID JSON ONLY — a single object matching the schema, no prose, no markdown."
)

# Target shape matches app.interview_prep.schema.ProbeSet (snake_case).
_SCHEMA = """
Return a JSON object with EXACTLY this shape:
{
  "probes": [
    { "prompt": "<what the interviewer asks>",
      "grounded_in": "<the profile/JD signal this probe is grounded in, or null>",
      "what_it_tests": "<the competency/behaviour this probe surfaces>" }
  ]
}
"""


def build_probes_prompt(grounding: dict, profile: dict) -> str:
    """`profile` is the candidate's descriptive profile; `grounding` is the Stage-1 context. Turn
    concrete profile signals into grounded probes calibrated to the role."""
    return (
        "Design candidate probes grounded in the profile below, calibrated to the role/level in the "
        "grounding. Every probe must anchor to a specific profile signal (or, if the profile is "
        "thin, to the role/JD — and say so).\n\n"
        f"GROUNDING:\n{json.dumps(grounding, ensure_ascii=False, indent=2)}\n\n"
        f"CANDIDATE PROFILE:\n{json.dumps(profile, ensure_ascii=False, indent=2)}\n"
        f"{_SCHEMA}"
    )
