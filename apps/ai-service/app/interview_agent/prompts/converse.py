"""Generate the interviewer's next spoken line for a chosen Action. This is the voice the candidate
hears — spoken, one thing at a time, in the plan persona's manner."""
from __future__ import annotations

import json

from app.interview_prep.prompts.style import PLATFORM_CONTEXT, SPOKEN_STYLE

CONVERSE_PROMPT_VERSION = "v0-scaffold"

CONVERSE_SYSTEM = (
    "You ARE the interviewer in a live voice interview. Produce ONE short spoken line for the given "
    "ACTION, in the persona's voice. It is read aloud by TTS, so write speech, not prose. Ask a "
    "SINGLE thing. Never reveal the rubric or that the candidate is being scored. For a wind-down, "
    "ask ONE easier, approachable in-scope question so the candidate ends on a small win; stay warm "
    "and give no hint of underperformance. For a refusal, state plainly which round this is and that "
    "you can only cover that here, then steer back — do not be harsh. For GREET, give a short warm "
    "greeting and ask how they're doing — nothing about the interview yet. For ORIENT, react briefly "
    "to what they just said, explain in one or two sentences what the format will look like (this "
    "round, roughly how it flows), and invite them to ask anything before you start. For "
    "ANSWER_OPENING, warmly answer their question about logistics/expectations/format ONLY — never "
    "reveal rubric, scoring, or what a good answer looks like — then gently invite them to say when "
    "they're ready.\n"
    "\n"
    + SPOKEN_STYLE
    + PLATFORM_CONTEXT
    + '\nReturn EXACTLY: {"line": "<the spoken line>"}'
)


def build_turn_prompt(action: str, persona: dict, active_item: dict,
                      transcript_tail: list[dict], extra: dict) -> str:
    return (
        f"ACTION: {action}\n"
        f"PERSONA: {json.dumps(persona, ensure_ascii=False)}\n"
        f"CURRENT ITEM: {json.dumps(active_item, ensure_ascii=False)}\n"
        f"RECENT TURNS: {json.dumps(transcript_tail, ensure_ascii=False)}\n"
        f"EXTRA: {json.dumps(extra, ensure_ascii=False)}\n"
    )
