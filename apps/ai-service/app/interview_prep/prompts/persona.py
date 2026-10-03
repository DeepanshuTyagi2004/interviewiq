"""Persona + round-arc prompt: build the interviewer persona, opening/closing script, and the
timed round arc (intro → warm-up → core → curveball → candidate-qs → wrap) for one session.

v5 DRAFT — real interviewer-voice text (product IP). Human review required before production.
Bump PERSONA_PROMPT_VERSION on any change so provenance tracks which prompt produced a plan.
"""
from __future__ import annotations

import json

from app.interview_prep.prompts.style import PLATFORM_CONTEXT, SPOKEN_STYLE

PERSONA_PROMPT_VERSION = "v5-published-brief-draft"

# The interviewer-persona system prompt. The LLM client folds this into the user turn (Gemma has
# no system role), so keep it self-contained.
PERSONA_SYSTEM = (
    "You design the INTERVIEWER for a single mock-interview session on InterviewIQ. Given a brief, "
    "job description, and candidate profile, invent a believable interviewer persona and a timed "
    "plan for how the round unfolds.\n"
    "\n"
    "Who you're designing for: this is practice for a candidate preparing for real placements "
    "(often a Tier-2/3 engineering student). The interviewer should feel like a real engineer at "
    "the target company — professional and genuinely rigorous at the stated level, but human enough "
    "to put a nervous candidate at ease. Do not inflate or soften the bar; calibrate it to the "
    "level.\n"
    "\n"
    "How to design it:\n"
    "- Persona: a plausible full name; a seniority that fits who would run THIS round at THIS level "
    "(e.g. an SDE-2/senior for an SDE-1 loop); a disposition and style_notes drawn from the brief's "
    "interviewerStyleNotes and companySpecificPatterns when present, else sensible defaults for the "
    "company/round. gender: set to \"male\", \"female\", or \"neutral\" — CONSISTENT with the "
    "invented name (e.g. a name that reads female -> \"female\"); use \"neutral\" only for a name "
    "that doesn't clearly read as either.\n"
    "- opening: 1-3 sentences the interviewer actually SAYS to start — a warm greeting, the format "
    "and rough timebox, an invite to ask questions. Make it sound spoken and slightly off-the-cuff, "
    "not a script read aloud (see SPEAKING STYLE below). closing: 1-2 spoken sentences to wrap — "
    "thank them, say what happens next.\n"
    "- round_arc: an ordered set of beats using ONLY the allowed phases, timeboxed to add up to a "
    "single round: use round.durationMinutes as the total timebox when present; otherwise typically "
    "30-60 minutes. Follow the published guidance in round.formats for how to conduct this round. "
    "Skip phases that don't fit the round type "
    "(a pure DSA screen may have no curveball); always leave a candidate-qs beat.\n"
    "- grounded_in: name the specific signals (brief field, JD line, or profile item) each major "
    "persona choice rests on. Never invent facts not present in the grounding.\n"
    "\n"
    "Stay strictly on the round named in `roundType`. The grounding's `round` block (its difficulty, "
    "topics, named problems, formats) is the substance for the core beats. `overallProcess` describes "
    "the company's WHOLE interview loop across every round and is background flavour only — do NOT pull "
    "other rounds' topics or formats into this round's arc (e.g. no machine-coding/LLD/OA content in a "
    "DSA round).\n"
    "This is interviewer-facing planning material — describe how the interviewer behaves; never "
    "grade, score, or rank the candidate.\n"
    "\n"
    + SPOKEN_STYLE
    + PLATFORM_CONTEXT
    + "\n"
    "Respond with VALID JSON ONLY — a single object matching the schema, no prose, no markdown."
)

# The target shape (field names match app.interview_prep.schema.PersonaAndArc, snake_case).
_SCHEMA = """
Return a JSON object with EXACTLY this shape:
{
  "persona": {
    "name": "<interviewer display name>",
    "seniority": "<e.g. Senior Software Engineer>",
    "disposition": "<e.g. warm but rigorous>",
    "gender": "male"|"female"|"neutral",
    "style_notes": "<how they probe / give hints, or null>",
    "opening": "<short opening script the interviewer says, or null>",
    "closing": "<short closing script, or null>",
    "grounded_in": ["<brief/JD/profile signal this persona is grounded in>"]
  },
  "round_arc": [
    { "phase": "intro"|"warm-up"|"core"|"curveball"|"candidate-qs"|"wrap",
      "title": "<short beat title>", "description": "<what happens in this beat, or null>",
      "timebox_mins": <int> }
  ]
}
"""


def build_persona_prompt(grounding: dict) -> str:
    """`grounding` is the deterministic Stage-1 context (company/role/level/round, brief signals,
    JD, profile summary). The prompt hands the model the grounding and asks it to design the
    interviewer and round arc for exactly that session."""
    return (
        "Design the interviewer persona and the timed round arc for this session. Use ONLY the "
        "grounding below — the company/role/level/roundType set the bar, the brief signals set the "
        "style, the JD sets the focus, and the candidate profile hints at rapport.\n\n"
        f"GROUNDING:\n{json.dumps(grounding, ensure_ascii=False, indent=2)}\n"
        f"{_SCHEMA}"
    )
