"""The interviewer decides what a request for a different problem gets (decided 2026-10-18): resist, change the problem, or end the coding part.

Today's flow was fixed in the conductor (the first ask is resisted, the second is the round's change, a later second ask ends the coding). A real
interviewer reads the candidate: someone who has not tried is held longer, someone who has struggled for a while and asks again gets another
problem. The model makes that read in one fast structured call; the conductor's hard limits bound it (`Conductor.allowed_change_actions`: the cap of
one change per round, a refusal first, the time a new problem needs, never the harder reserve). The call never blocks the reply: a timeout, an error
or an answer outside what is allowed falls back to the persona's prior (`fallback_action`), which for a blueprint without a realism block is
exactly today's rule."""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Literal

logger = logging.getLogger(__name__)

ChangeAction = Literal["resist", "change", "end_coding", "next_question"]
ACTIONS: tuple[ChangeAction, ...] = ("resist", "change", "end_coding")
DECISION_TIMEOUT_S = 1.2       # the call answers in ~0.6 s on the talker's chat (reasoning off); past this the persona's prior decides
DECISION_MAX_TOKENS = 60
DECISION_TEMPERATURE = 0.0     # a judgement, not speech: the same situation gets the same answer

SCHEMA = {"type": "object", "properties": {"action": {"type": "string", "enum": list(ACTIONS)}, "why": {"type": "string"}}, "required": ["action", "why"]}

_GUIDE = {
    "resist": "keep them on this problem: you hold your ground, kindly",
    "change": "give them a different problem now",
    "end_coding": "close the coding part: no other problem comes, the round moves on",
}

PROMPT = """You are the interviewer in a live mock job interview. The candidate has just asked for a different problem. Decide what you do. Reply with JSON
{"action": "resist" | "change" | "end_coding", "why": short text}.

- resist: keep them on this problem and encourage them to carry on.
- change: give them a different problem now (the round allows one change).
- end_coding: stop the coding part; no other problem is given and the interview moves on.

Decide as a real interviewer of your temperament would. A candidate who has not really tried yet is held longer; one who has tried for a while, is stuck and asks again
deserves a change or an end to the coding; a firm interviewer gives in later than a soft one. Their own words matter: frustration or real distress weighs more than
a casual "can we change it?". You may only pick one of the allowed actions."""


def fallback_action(refusals_prior: int, refusals_problem: int, allowed: frozenset[str]) -> ChangeAction:
    """The persona's prior when the model cannot decide: resist until the problem has had `refusals_prior` refusals, then the change if it is
    allowed, else the end of the coding part, else resist. With `refusals_prior` 1 this is today's rule (first ask resisted, then the round's
    one change, then after it a resist and the end of the coding)."""
    if refusals_problem < refusals_prior and "resist" in allowed:
        return "resist"
    for action in ("change", "end_coding"):
        if action in allowed:
            return action
    return "resist"


def _messages(*, firmness: str, refusals_problem: int, refusals_round: int, changes_round: int, candidate_text: str, attempted: bool,
              minutes_left: float, allowed: frozenset[str]) -> list[dict[str, str]]:
    options = "\n".join(f"- {a}: {_GUIDE[a]}" for a in ACTIONS if a in allowed)
    facts = (f"Your temperament about changing a problem: {firmness}.\n"
             f"Times you have already refused to change THIS problem: {refusals_problem}.\n"
             f"Refusals so far in this round: {refusals_round}. Changes already given this round: {changes_round}.\n"
             f"Has the candidate written any code on this problem: {'yes' if attempted else 'no'}.\n"
             f"Time left in the round: about {max(0, round(minutes_left))} minutes.\n"
             f"Allowed actions:\n{options}\n"
             f'The candidate said: "{(candidate_text or "").strip()[:400]}"')
    return [{"role": "system", "content": PROMPT}, {"role": "user", "content": facts}]


async def decide_change(chat: Any, *, firmness: str, refusals_problem: int, refusals_round: int, changes_round: int, candidate_text: str,
                        attempted: bool, minutes_left: float, allowed: frozenset[str], timeout_s: float = DECISION_TIMEOUT_S,
                        refusals_prior: int | None = None) -> tuple[ChangeAction, str, str]:
    """What the candidate's request gets, where the answer came from ("model" or "fallback": a timeout, an error, an answer that is not one of
    `allowed`) and the model's own reason ("" for a fallback; recorded on the turn after live round 781a1f0a, 2026-10-18). Never raises. `chat` is the talker's chat at temperature 0, reasoning off. `refusals_prior` is the persona's stance for the fallback; without
    it the firmness stands in for it (a firm persona refuses twice)."""
    prior = refusals_prior if refusals_prior is not None else (2 if firmness == "firm" else 1)
    fallback = fallback_action(prior, refusals_problem, allowed)
    try:
        messages = _messages(firmness=firmness, refusals_problem=refusals_problem, refusals_round=refusals_round, changes_round=changes_round,
                             candidate_text=candidate_text, attempted=attempted, minutes_left=minutes_left, allowed=allowed)
        data, _ = await asyncio.wait_for(chat.json(messages, "change_decision", SCHEMA, DECISION_MAX_TOKENS), timeout_s)
        action = str((data or {}).get("action") or "").strip().lower()
        if action in allowed and action in ACTIONS:
            why = str((data or {}).get("why") or "")[:120]
            logger.info("change decision: %s (%s)", action, why)
            return action, "model", why          # type: ignore[return-value]
        logger.warning("change decision outside what is allowed: %r", action)
    except Exception as exc:  # noqa: BLE001 - a decision that cannot be made never blocks the reply
        logger.warning("change decision failed: %s: %s", type(exc).__name__, exc)
    return fallback, "fallback", ""
