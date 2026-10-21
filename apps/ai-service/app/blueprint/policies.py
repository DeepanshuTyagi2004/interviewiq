"""Stage 7, global policies and evaluation signals (spec §6 stage 7). A versioned template, the same in
every interview — PRODUCT IP drafted for human review. No LLM: consistency matters more than variety."""
from __future__ import annotations

from app.blueprint.models import Policies, RequestPolicy
from app.blueprint.vocabulary import family
from app.rounds.base import COMMON_SIGNALS
from app.rounds.compose import PACKS, pack_for

POLICY_VERSION = "pol2"

_REQUESTS: tuple[tuple[str, str, str], ...] = (
    ("repeat_question", "comply", "Repeat or rephrase the question calmly; never add new hints while repeating."),
    ("clarify_requirement", "comply", "Answer from the slot's clarifications; if not covered, give a reasonable, consistent assumption."),
    ("ask_hint", "comply", "Give the next step of the hint ladder only, and note it for evaluation."),
    ("ask_solution", "decline", "Decline kindly: the goal is to see their thinking. Offer the next hint instead."),
    ("ask_if_correct", "partial", "Don't confirm or deny outright; ask them to verify with an example or a dry run."),
    ("change_language", "comply", "Any mainstream language is fine; keep the same problem."),
    ("use_internet_or_ai", "decline", "Not allowed in this interview, same as a real one; they can reason aloud instead."),
    ("take_break", "comply", "A short pause is fine; the clock keeps running, say so gently."),
    ("skip_question", "partial", "Offer a hint first; if they still want to move on, switch to the reserve or next question."),
    ("extend_time", "partial", "Allow a minute or two if they are close; otherwise wrap up the question and move on."),
    ("ask_about_company", "comply", "Answer generally and honestly in the candidate-questions phase; never claim to represent the company."),
    ("ask_for_feedback_now", "decline", "Feedback comes after the interview in the report; encourage them to keep going."),
    ("ask_about_result", "decline", "This is a mock interview; results and the debrief come in the report afterwards."),
    ("personal_or_inappropriate", "decline", "Decline politely and steer back to the interview without judgement."),
)

_GENERAL = {
    "off_topic": "Acknowledge briefly and warmly, then steer back to the current question; don't lecture.",
    "time_management": ("Watch each slot's timebox. Near the end of a slot, ask for their final approach and complexity, then "
                        "move on. Never cut the candidate questions or wrap-up phases."),
    "integrity": ("If answers look read out or pasted, ask them to explain a specific line or decision in their own words. "
                  "Don't accuse; note it as an evaluation signal."),
    "fallback": ("When no rule fits, act as a fair, experienced interviewer would: keep the candidate talking, stay "
                 "consistent with the answer key, and never reveal the answer key."),
}

def policies(round_type: str | None = None) -> Policies:
    """The request policies: today's 14 kinds, then the round's pack applies its overrides (None drops a kind, a new kind is appended)
    and its general-policy texts. No round type gives the DSA text."""
    pack = pack_for(round_type) if round_type else None
    overrides = pack.policy_overrides if pack else {}
    requests = [(k, *overrides[k]) if overrides.get(k) else (k, d, h) for k, d, h in _REQUESTS if k not in overrides or overrides[k]]
    requests += [(k, *v) for k, v in overrides.items() if v is not None and k not in {r[0] for r in _REQUESTS}]
    general = {**_GENERAL, **(pack.general_overrides if pack else {})}
    return Policies(version=POLICY_VERSION,
                    requests=[RequestPolicy(kind=k, decision=d, how=h) for k, d, h in requests],
                    **general)


def global_signals(round_type: str) -> list[dict]:
    """The round's signals then the common ones: the pack registered for this round type or its family."""
    pack = PACKS.get(round_type) or PACKS.get(family(round_type))
    signals = pack.signals if pack else ()
    return [{"signal": s, "observe": o} for s, o in (*signals, *COMMON_SIGNALS)]
