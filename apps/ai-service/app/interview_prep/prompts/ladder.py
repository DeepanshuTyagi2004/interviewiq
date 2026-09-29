"""Question-ladder prompt: for each seed question (from the bank + brief), build an escalating
ladder — a base prompt, ordered follow-ups (easiest→hardest), increasingly explicit hints, a
weighted interviewer rubric, and a timebox.

v1 DRAFT — product IP. Reviewed/tuned by a human before production. Bump LADDER_PROMPT_VERSION on
any change so provenance tracks which prompt produced a plan.

NOTE: the rubric produced here is INTERVIEWER-ONLY evaluation material and lives ONLY on the
InterviewPlan — it is never added to any Profile Builder / ProfileSummary contract.
"""
from __future__ import annotations

import json

from app.interview_prep.prompts.style import PLATFORM_CONTEXT, SPOKEN_STYLE

LADDER_PROMPT_VERSION = "v3"

# The question-ladder system prompt. The LLM client folds this into the user turn.
LADDER_SYSTEM = (
    "You turn each seed question into a QUESTION LADDER an interviewer can run in a live round. A "
    "ladder is one question the interviewer can escalate or de-escalate depending on how the "
    "candidate does.\n"
    "\n"
    "For every seed question, produce one ladder:\n"
    "- question_slug: echo the seed's slug when it has one, else null.\n"
    "- base_prompt: how the interviewer first poses the question OUT LOUD, in their own voice (see "
    "SPEAKING STYLE below), calibrated to the round type and to the level/difficulty in the grounding "
    "(an SDE-1 DSA prompt is not phrased like a staff system-design prompt).\n"
    "- follow_ups: ordered easiest → hardest. Each should deepen the SAME question (optimize, add a "
    "constraint, scale it, handle an edge case), not jump to an unrelated topic. Each one is a single "
    "question asked on its own, in continuation of the previous — never a line that stacks two or "
    "three asks together.\n"
    "- hints: ordered subtle → explicit — what the interviewer offers a STUCK candidate to keep the "
    "round moving. A hint nudges toward the idea; it never hands over the full answer.\n"
    "- rubric: 3-5 criteria the interviewer watches, each with a weight (relative importance, "
    "numbers that sum to roughly 1.0) and concrete strong_descriptor / weak_descriptor for what a "
    "strong vs weak answer looks like. This guides the interviewer's judgement; it does not assign "
    "the candidate a score here.\n"
    "- timebox_mins: a realistic budget for this question within the round.\n"
    "\n"
    "Calibrate everything to the company/role/level and the grounding's `round` block (its difficulty, "
    "topics, and named problems for THIS round). `overallProcess` is company-wide background across all "
    "rounds — never turn its other-round topics/formats (machine-coding/LLD/OA/etc.) into ladders here. "
    "Stay grounded in the seeds and grounding; do not invent problems the seeds don't imply.\n"
    "\n"
    + SPOKEN_STYLE
    + PLATFORM_CONTEXT
    + "\n"
    "Respond with VALID JSON ONLY — a single object matching the schema, no prose, no markdown."
)

# Target shape matches app.interview_prep.schema.LadderSet (snake_case).
_SCHEMA = """
Return a JSON object with EXACTLY this shape:
{
  "ladders": [
    {
      "question_slug": "<slug of the seed question if given, else null>",
      "base_prompt": "<the question as the interviewer would pose it>",
      "difficulty": "easy"|"medium"|"hard"|null,
      "follow_ups": ["<escalating follow-up, easiest first>"],
      "hints": ["<hint, subtle first and increasingly explicit>"],
      "rubric": [
        { "criterion": "<what to evaluate>", "weight": <number>,
          "strong_descriptor": "<what a strong answer looks like>",
          "weak_descriptor": "<what a weak answer looks like>" }
      ],
      "timebox_mins": <int|null>
    }
  ]
}
"""


def build_ladder_prompt(grounding: dict, seed_questions: list[dict]) -> str:
    """`seed_questions` are thin question-bank records (slug/title/url/difficulty/topic_tags) for
    this round; `grounding` is the Stage-1 context. Build one ladder per seed."""
    return (
        "Build one ladder for EACH seed question below, calibrated with the grounding "
        "(company/role/level + the brief's difficulty and dominant topics). Keep the order of the "
        "seeds. Do not add ladders for questions not in the seed list.\n\n"
        f"GROUNDING:\n{json.dumps(grounding, ensure_ascii=False, indent=2)}\n\n"
        f"SEED QUESTIONS:\n{json.dumps(seed_questions, ensure_ascii=False, indent=2)}\n"
        f"{_SCHEMA}"
    )
