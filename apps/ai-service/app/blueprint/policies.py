"""Stage 7, global policies and evaluation signals (spec §6 stage 7). A versioned template, the same in
every interview — PRODUCT IP drafted for human review. No LLM: consistency matters more than variety."""
from __future__ import annotations

from app.blueprint.models import Policies, RequestPolicy

POLICY_VERSION = "pol1"

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

_GLOBAL_SIGNALS = {
    "dsa": (("problem_understanding", "Restates the problem, asks clarifying questions, checks constraints and edge cases first."),
            ("approach", "Moves from a brute force to a better approach and can justify why it is better."),
            ("coding", "Writes correct, readable code; names things well; handles edge cases."),
            ("testing", "Dry-runs the code on an example and on an edge case without being asked."),
            ("complexity", "States time and space complexity correctly.")),
    "system-design": (("requirements", "Clarifies functional and non-functional requirements and scale before designing."),
                      ("design", "Proposes coherent components and data flow; justifies storage choices."),
                      ("trade_offs", "Names alternatives and picks one for stated reasons."),
                      ("scale_and_failure", "Finds bottlenecks and failure modes and addresses them.")),
    "lld": (("modelling", "Identifies the right entities and responsibilities."),
            ("design_quality", "Uses sensible abstractions and patterns without over-engineering."),
            ("extensibility", "Handles a new requirement with small, local changes."),
            ("code", "Writes working, readable code when asked.")),
    "behavioural": (("structure", "Answers with a clear situation, task, action and result."),
                    ("ownership", "Speaks about their own actions ('I'), not only the team's."),
                    ("impact", "Gives concrete, ideally measurable results."),
                    ("self_awareness", "Reflects honestly on mistakes and what they learned.")),
}

_COMMON_SIGNALS = (("communication", "Thinks aloud, explains clearly, listens to the interviewer."),
                   ("receptiveness", "Uses hints well and adapts when nudged."),
                   ("composure", "Stays steady when stuck; recovers after mistakes."))


def policies() -> Policies:
    return Policies(version=POLICY_VERSION,
                    requests=[RequestPolicy(kind=k, decision=d, how=h) for k, d, h in _REQUESTS],
                    **_GENERAL)


def global_signals(family: str) -> list[dict]:
    return [{"signal": s, "observe": o} for s, o in (*_GLOBAL_SIGNALS.get(family, ()), *_COMMON_SIGNALS)]
