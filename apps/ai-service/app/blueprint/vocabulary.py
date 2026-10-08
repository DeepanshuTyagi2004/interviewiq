"""Fixed vocabularies the blueprint is written in (spec §8.1, §8.2).

The live interviewer classifies each moment into one of these conditions and follows the slot's rule
for it; a closed vocabulary keeps playbooks checkable (every slot must cover every condition of its
family) and the interview traceable for scoring.
"""
from __future__ import annotations

from typing import Literal

# ---------------------------------------------------------------- round families

FAMILY_OF_ROUND = {
    "dsa": "dsa",
    "online-assessment": "dsa",
    "system-design": "system-design",
    "lld": "lld",
    "behavioural": "behavioural",
    "hiring-manager": "behavioural",
}


def family(round_type: str) -> str:
    return FAMILY_OF_ROUND.get(round_type, "dsa")


# ---------------------------------------------------------------- conditions

COMMON_CONDITIONS = ("stuck", "long_silence", "asks_clarification", "asks_hint", "asks_for_answer",
                     "off_topic", "seen_before", "over_time", "nervous")

FAMILY_CONDITIONS = {
    "dsa": ("wrong_approach", "partially_correct", "correct_suboptimal", "correct_optimal", "bug_in_code"),
    "lld": ("wrong_approach", "partially_correct", "correct_suboptimal", "correct_optimal", "bug_in_code"),
    "system-design": ("skips_requirements", "shallow_design", "ignores_scale", "strong_design"),
    "behavioural": ("vague_answer", "no_result", "only_we", "inconsistent", "strong_story"),
}

ALL_CONDITIONS = tuple(dict.fromkeys(COMMON_CONDITIONS + tuple(c for cs in FAMILY_CONDITIONS.values() for c in cs)))

# What each condition means. The playbook writer sees these (bare names were misread: "seen_before"
# came back as "I've seen this before" or "the candidate repeated a story"). PRODUCT IP draft.
CONDITION_MEANINGS: dict[str, str] = {
    "stuck": "the candidate can't see how to start or how to continue",
    "long_silence": "the candidate has said nothing for a while",
    "asks_clarification": "the candidate asks about requirements, inputs, constraints or scope",
    "asks_hint": "the candidate asks for a hint",
    "asks_for_answer": "the candidate asks to be told the answer or the solution",
    "off_topic": "the candidate talks about something unrelated to this question",
    "seen_before": "the candidate says they already know this exact question (solved it before, or already answered it "
                   "earlier in this interview); move to a different question",
    "over_time": "this question's time is up",
    "nervous": "the candidate sounds anxious, apologises a lot or freezes",
    "wrong_approach": "the candidate commits to an approach that can't work",
    "partially_correct": "the approach works but misses cases or requirements",
    "correct_suboptimal": "a correct solution that is slower or heavier than needed",
    "correct_optimal": "a correct, optimal solution",
    "bug_in_code": "the code has a bug",
    "skips_requirements": "the candidate starts designing before agreeing requirements and scale",
    "shallow_design": "boxes and arrows with no depth on any component",
    "ignores_scale": "the design ignores the stated load, data size or growth",
    "strong_design": "a sound design that covers the requirements",
    "vague_answer": "the story stays general, with no specific situation",
    "no_result": "the story has no outcome",
    "only_we": "the candidate only says 'we' and never what they did themselves",
    "inconsistent": "details contradict what the candidate said earlier",
    "strong_story": "a specific story with the candidate's own actions and a result",
}

# Conditions whose action is fixed by policy. A playbook branch with another action is replaced by the
# default rule below, so the live interviewer always reacts the same way to these moments.
PINNED_ACTIONS: dict[str, str] = {
    "seen_before": "switch_to_reserve",
    "asks_for_answer": "decline_politely",
    "off_topic": "redirect",
    "over_time": "wrap_up_slot",
}


# Slots holding a technical round's behavioural part ("Coding + Leadership Principles") carry this prefix.
CULTURE_PREFIX = "culture-"


def is_culture_slot(slot_id: str) -> bool:
    return slot_id.startswith(CULTURE_PREFIX)


def slot_round_type(round_type: str, slot_id: str) -> str:
    """The round type a slot is run as: behavioural for a technical round's behavioural part."""
    return "behavioural" if is_culture_slot(slot_id) else round_type


def required_conditions(round_type: str) -> tuple[str, ...]:
    """Every condition a slot of this round must have a rule for."""
    return COMMON_CONDITIONS + FAMILY_CONDITIONS[family(round_type)]


# ---------------------------------------------------------------- actions

ACTIONS = ("give_hint", "clarify", "probe_deeper", "ask_follow_up", "reframe", "redirect", "encourage",
           "acknowledge_move_on", "ask_complexity", "ask_dry_run", "switch_to_reserve", "decline_politely",
           "wrap_up_slot")

Action = Literal["give_hint", "clarify", "probe_deeper", "ask_follow_up", "reframe", "redirect", "encourage",
                 "acknowledge_move_on", "ask_complexity", "ask_dry_run", "switch_to_reserve", "decline_politely",
                 "wrap_up_slot"]

# ---------------------------------------------------------------- default rules
# Policy-consistent fallbacks for a condition a playbook still misses after its repair round. They are
# generic on purpose; a backfilled rule is marked in its notes and in the run trace. PRODUCT IP draft.

DEFAULT_BRANCHES: dict[str, tuple[str, str, str]] = {
    "stuck": ("give_hint", "Let's take a step back. What's the simplest version of this you could solve?", "next step of the hint ladder"),
    "long_silence": ("encourage", "Take your time. Thinking out loud helps me follow your reasoning.", ""),
    "asks_clarification": ("clarify", "Good question.", "answer from the clarifications; otherwise state a reasonable, consistent assumption"),
    "asks_hint": ("give_hint", "Sure, here's a nudge.", "next step of the hint ladder only"),
    "asks_for_answer": ("decline_politely", "I'd rather see how you'd think it through. Here's a hint instead.", "never reveal the answer key"),
    "off_topic": ("redirect", "Interesting! Let's come back to the question for now.", ""),
    "seen_before": ("switch_to_reserve", "Thanks for telling me. Let's try a different one.", ""),
    "over_time": ("wrap_up_slot", "We're nearly out of time on this one. Summarise where you got to.", ""),
    "nervous": ("encourage", "No pressure, this is practice. Walk me through whatever you're thinking.", ""),
    "wrong_approach": ("probe_deeper", "Can you check that idea against a small example?", ""),
    "partially_correct": ("ask_follow_up", "That covers part of it. Which cases might break it?", ""),
    "correct_suboptimal": ("ask_complexity", "That works. What's its complexity, and can we do better?", ""),
    "correct_optimal": ("ask_follow_up", "Nice. How would you test it, and what if the constraints changed?", ""),
    "bug_in_code": ("ask_dry_run", "Let's dry-run your code on a small input.", ""),
    "skips_requirements": ("clarify", "Before we design, what requirements and scale should we target?", ""),
    "shallow_design": ("probe_deeper", "Let's go deeper on one component. How does it behave under load?", ""),
    "ignores_scale": ("probe_deeper", "What changes at ten times the traffic?", ""),
    "strong_design": ("ask_follow_up", "Good. What are the main trade-offs, and how would it fail?", ""),
    "vague_answer": ("probe_deeper", "Can you walk me through one specific example?", ""),
    "no_result": ("probe_deeper", "What was the outcome, and how did you know?", ""),
    "only_we": ("probe_deeper", "What was your own part in that?", ""),
    "inconsistent": ("clarify", "Help me connect that with what you mentioned earlier.", ""),
    "strong_story": ("ask_follow_up", "Great example. What would you do differently next time?", ""),
}

# ---------------------------------------------------------------- arc

PHASES = ("greeting", "small_talk", "framing", "candidate_intro", "core", "candidate_questions", "wrap_up")
Phase = Literal["greeting", "small_talk", "framing", "candidate_intro", "core", "candidate_questions", "wrap_up"]
UNSCORED_PHASES = frozenset({"greeting", "small_talk", "framing", "wrap_up"})

# ---------------------------------------------------------------- run stages (spec §6) and friendly labels (§9.1)

STAGES = ("context", "selection", "answer_keys", "persona", "personalization", "playbooks", "policies", "validate")

STAGE_LABELS = {
    "context": "Context",
    "selection": "Problem selection",
    "answer_keys": "Answer keys",
    "persona": "Persona and arc",
    "personalization": "Personalization",
    "playbooks": "Playbooks",
    "policies": "Policies",
    "validate": "Assemble and validate",
}

# ---------------------------------------------------------------- failure codes (spec §12)

FAILURE_CODES = ("round_not_found", "not_enough_problems", "answer_key_failed", "playbook_failed",
                 "llm_unavailable", "validation_failed", "timeout", "cancelled", "interrupted", "internal_error")
