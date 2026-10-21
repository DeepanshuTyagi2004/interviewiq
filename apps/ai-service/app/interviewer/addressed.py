"""Is the candidate talking to the interviewer? (decided 2026-10-19; spec "Addressed to the interviewer")

A candidate who thinks aloud or reads the problem aloud is not asking anything, and a reply to that interrupts them. The rules here place most
utterances without a model call; what they cannot place is left (`None`) for the model, and `lean` is the fallback when it is not asked or fails.
`AddressedState` is what the run remembers across a round (check-ins used per problem, the nudge timer); it round-trips through the checkpoint."""
from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Literal

from app.interviewer.closing import (asks_for_constraints, asks_for_format, asks_for_help, asks_for_hint, asks_to_change_problem, asks_to_explain,
                                     awaiting_answer)

logger = logging.getLogger(__name__)

Addressed = Literal["to_interviewer", "thinking_aloud", "reading_problem", "unclear"]
ADDRESSED_VALUES = ("to_interviewer", "thinking_aloud", "reading_problem", "unclear")
ADDRESSED_PROMPT_VERSION = "a1"
ADDRESSED_TIMEOUT_S = 0.8
ADDRESSED_THRESHOLD = 0.6
ADDRESSED_MAX_TOKENS = 40
ADDRESSED_TEMPERATURE = 0.0

# The first seconds after a problem goes up lean to "reading it aloud".
READING_LEAN_S = 60.0
NUDGE_AFTER_S = 10.0     # after a check-in, a silence this long gets one nudge, never a second (and never a reply: silence is not a question)
ASK_ARMED_S = 15.0       # the Ask interviewer button counts for the next words said within this long

QUICK_QUESTION = re.compile(r"\bquick question\b", re.I)
DIRECT_REQUEST = re.compile(
    r"\b(?:can you|could you|would you|is it (?:ok|okay|fine|alright) if|should i|sorry|excuse me|do you mean|are we allowed|am i allowed)\b", re.I)
SELF_TALK = re.compile(r"^\s*(?:hmm+|umm?|uh+|wait|okay so|ok so|so if|let me think|let me see|maybe i|i'll|i will|i think i)\b", re.I)
_THINKING_REPLY = re.compile(
    r"\b(?:no|nope|just thinking|thinking|working (?:it|through)|myself|not (?:for|to) you|out loud|carry on|keep going)\b", re.I)
_DIRECT_NO_SORRY = re.compile(r"\b(?:can you|could you|would you|do you mean|are we allowed|am i allowed)\b", re.I)
_WH_ANYWHERE = re.compile(r"\b(?:what (?:does|do|is|are|if|about|happens)|how (?:do|does|can|should|many|much)|why|which|i mean)\b", re.I)
_NOT_FOR_YOU = re.compile(r"\bnot (?:for|to) you\b", re.I)
_FOR_YOU = re.compile(r"\b(?:for|to) (?:you|me)\b", re.I)
_INTERROGATIVE_START = re.compile(
    r"^\s*(?:(?:so|and|okay|ok|um+|uh+|well)\b[,\s]*)*(?:what|how|why|does|do|is|are|can|could|should|will|would|which|where|when)\b", re.I)
_YES_START = re.compile(r"^\s*(?:yes|yeah|yep)\b", re.I)


_FILLER = re.compile(
    r"^\s*(?:(?:hmm+|umm?|uh+|er+|ah+|oh|so|and|okay|ok|well|wait|also|actually|then|but|no|nope|yeah|yes|sorry|like|now|right|i mean|i was wondering|"
    r"i wanted to ask|just)\b[,\s]*)+", re.I)
_YES_NO_START = re.compile(r"^(?:does|do|is|are|can|could|should|will|would|am|may|shall|did)\b", re.I)
_WH_START = re.compile(r"^(?:what|how|why|which|where|when|who)\b", re.I)
# A question in the middle of a sentence ("I think I will use dp, is that fine", "so can I use extra space"), or a closing tag question.
_ASK_ANYWHERE = re.compile(
    r"\b(?:(?:can|could|may|should|shall|do|does|am) (?:i|we)\b|(?:can|could) (?:the|it|n|there|this|that|a|an)\b|(?:is|are) (?:it|that|this|there|we) (?:ok|okay|fine|alright|allowed|possible|right|correct|enough|good)\b|"
    r"(?:is|are) (?:there|it|we)\b|is that (?:fine|ok|okay|right|correct|alright)|"
    r"what(?:'s| is| are) the (?:format|time limit|space limit|limits?|input|output|inputs|outputs|size|range|expected)|does that (?:make sense|work)|makes sense\?|doubts?|questions?)\b|(?:\bright|\bcorrect)\s*[?.!]*\s*$", re.I)
# A wh-question or "tell me" inside a read-out ("given a string of digits what does zero decode to"): the read-out stops being only a read-out.
_ASK_IN_READOUT = re.compile(r"\b(?:what (?:does|do|is|are|if|about|happens)|tell me|give me|show me|i mean)\b", re.I)
# The interviewer invites the candidate to ask ("let me know if...", "just say"): from then on only a specific ask is answered on that item (direct-only).
INVITES = re.compile(
    r"\b(?:let me know|tell me if|say if you|just say|feel free to (?:ask|say|tell)|if you'd like (?:me|to ask)|when you(?:'re| are) ready|"
    r"whenever you(?:'re| are)? ready|whenever you want me|i'm here if you need|ask me (?:if|anything|whenever))", re.I)
_CLAUSE_SPLIT = re.compile(r"[,.;:!?\-]+")
_HELP_WORD = re.compile(r"\bhelp\b", re.I)
_STUCK = re.compile(r"\b(?:stuck|lost|confused|no idea|not sure|don'?t (?:know|understand|get)|do not (?:know|understand))\b", re.I)


def _clauses(text: str) -> list[str]:
    return [c for c in (_FILLER.sub("", x).strip() for x in _CLAUSE_SPLIT.split(text or "")) if c]


def is_strong_request(text: str, *, reveal: bool = True) -> bool:
    """A plain ask of the interviewer, by the shared detectors (hint, a different problem, constraints, an explanation, the format) or a direct
    "can you / sorry / should I", stuck or help: for the interviewer without asking a model. (asks_for_help is too broad for this: it matches "done" and any "?".)
    `reveal=False` leaves out the asks a read-out of the problem trips ("constraints", "explain"): a candidate reading the statement aloud is not asking."""
    t = text or ""
    if DIRECT_REQUEST.search(t) or asks_for_hint(t) or asks_to_change_problem(t) or _STUCK.search(t) or _HELP_WORD.search(t):
        return True
    return reveal and bool(asks_for_constraints(t) or asks_to_explain(t) or asks_for_format(t))


def is_ask_cue(text: str) -> bool:
    """A yes/no question or a closing "is that fine / right", anywhere in the words, with or without a question mark (speech-to-text drops it)."""
    t = text or ""
    return bool(_ASK_ANYWHERE.search(t) or any(_YES_NO_START.match(c) for c in _clauses(t)))


def has_question_cue(text: str) -> bool:
    """Any sign the words may be a question or a request: a question mark, a request, a yes/no ask or a wh-word opening any clause."""
    t = text or ""
    return "?" in t or asks_for_help(t) or is_strong_request(t) or is_ask_cue(t) or any(_WH_START.match(c) for c in _clauses(t))


_DIRECT_ASK_WORDS = re.compile(
    r"\b(?:please|repeat|again|one more time|explain|i want to|i'd like to|i would like to|i'd prefer|i would prefer|"
    r"(?:do not|don't|didn't|did not) (?:get|understand))\b", re.I)


def has_direct_ask_cue(text: str) -> bool:
    """The cue for a specific ask on an item where the interviewer invited questions: any question cue, plus a polite or plain request
    ("repeat that please", "explain example two", "I'd prefer java", "I do not get it")."""
    return has_question_cue(text) or bool(_DIRECT_ASK_WORDS.search(text or ""))


def is_invite(text: str) -> bool:
    """An interviewer line that invites the candidate to ask (one regex search)."""
    return bool(INVITES.search(text or ""))


def asks_inside_readout(text: str) -> bool:
    """An ask anywhere in words that overlap the problem: a yes/no ask, a question mark, a wh-clause opening any clause, "what does ...", "tell me / give me ...".
    A pure read-out has none of these. (The constraints detector is left out on purpose: a statement that says "constraints" is not an ask.)"""
    t = text or ""
    return bool(is_ask_cue(t) or "?" in t or any(_WH_START.match(c) for c in _clauses(t)) or _ASK_IN_READOUT.search(t))


def classify_by_rules(text: str, *, last_line: str, reading: bool, typing: bool, ask_armed: bool, on_problem: bool = True) -> Addressed | None:
    """Place an utterance by rule, in order of certainty; `None` means the rules cannot tell. A question or a request is never placed as
    thinking aloud or reading (an extra check-in is cheaper than a missed question): anything carrying a cue goes to the model unless it is a plain ask."""
    if ask_armed or QUICK_QUESTION.search(text):
        return "to_interviewer"
    # Their next words answer what the interviewer just asked (a question, or "walk me through...").
    if (last_line or "").rstrip().endswith("?") or awaiting_answer(last_line):
        return "to_interviewer"
    if is_strong_request(text, reveal=not reading):
        return "to_interviewer"
    if reading:
        # Reading the statement aloud: only a real yes/no ask inside it ("..., is the array sorted") takes it out of the read-out.
        return None if asks_inside_readout(text) else "reading_problem"
    if has_question_cue(text):
        return None                    # a question to themselves ("and what could zero decode to?") is exactly what the rules cannot place
    if on_problem and (SELF_TALK.search(text) or typing):
        if has_direct_ask_cue(text):
            return None                # a request ("explain example two", "I'd prefer java") typed over or muttered: the model and the gate decide
        return "thinking_aloud"
    return None


def lean(text: str, *, since_problem_s: float | None, overlaps_problem: bool = False, on_problem: bool = False) -> Addressed:
    """The fallback when the model is not asked or fails: a question never falls to silence, and ties go to the check-in. Silence only for words that
    clearly are the problem read out (they share words with it, early) or clear self-talk on a problem."""
    if has_question_cue(text):
        return "unclear"
    if overlaps_problem and since_problem_s is not None and since_problem_s < READING_LEAN_S:
        return "reading_problem"
    if on_problem and SELF_TALK.search(text):
        return "thinking_aloud"
    return "unclear"


def answers_checkin(text: str) -> Literal["thinking", "for_me"]:
    """Their reply to "is that one for me?": anything but a clear "just thinking" counts as for the interviewer. A question or a request inside the
    reply ("no, can you give me a hint", "no that was a question") is for the interviewer before any thinking word is read."""
    t = text or ""
    if _NOT_FOR_YOU.search(t):
        return "thinking"
    if (_DIRECT_NO_SORRY.search(t) or is_strong_request(t) or is_ask_cue(t) or has_question_cue(t) or _WH_ANYWHERE.search(t)
            or _FOR_YOU.search(t)):
        return "for_me"
    if _THINKING_REPLY.search(t) and not _YES_START.search(t):
        return "thinking"
    return "for_me"


SCHEMA = {"type": "object", "properties": {"addressed": {"enum": list(ADDRESSED_VALUES)}, "confidence": {"type": "number"}},
          "required": ["addressed", "confidence"]}

PROMPT = """You watch a mock interview. Decide who the candidate's latest words are for. Answer with JSON only: {"addressed": ..., "confidence": 0 to 1}.
- to_interviewer: they ask or tell the interviewer something. Example: "Can the string be empty?"
- thinking_aloud: they talk to themselves while working. Example: "Okay so if I take the first digit, then the rest..."
- reading_problem: they read the problem statement aloud. Example: "Given a string of digits, return the number of ways to decode it."
- unclear: you cannot tell. Example: "What happens with zero?"
A question the candidate asks themselves while working is thinking_aloud only when it is clearly rhetorical; when in doubt answer unclear."""


def _messages(*, last_line: str, text: str, phase: str, problem_excerpt: str, typing: bool, recent: list[str]) -> list[dict]:
    facts = (f"Round phase: {phase}\nProblem: {(problem_excerpt or '')[:400]}\nInterviewer's last line: {last_line}\n"
             f"Candidate is typing code right now: {'yes' if typing else 'no'}\n"
             f"Candidate's recent utterances: {' | '.join(recent[-3:]) if recent else '(none)'}\nCandidate's latest words: {text}")
    return [{"role": "system", "content": PROMPT}, {"role": "user", "content": facts}]


async def classify_by_model(chat: Any, *, last_line: str, text: str, phase: str, problem_excerpt: str, typing: bool, recent: list[str],
                            since_problem_s: float | None, overlaps_problem: bool = False, on_problem: bool = False,
                            timeout_s: float = ADDRESSED_TIMEOUT_S, raw: dict | None = None) -> tuple[Addressed, float, str]:
    """(result, confidence, source): source is "model" or "fallback" (a timeout, an error, an answer that is not one of the four, which fall to `lean`).
    A model answer below the confidence threshold is `unclear` (the label it gave is kept in `raw["label"]` when a dict is passed). Never raises."""
    try:
        if hasattr(chat, "with_temperature"):
            chat = chat.with_temperature(ADDRESSED_TEMPERATURE)
        messages = _messages(last_line=last_line, text=text, phase=phase, problem_excerpt=problem_excerpt, typing=typing, recent=recent)
        data, _ = await asyncio.wait_for(chat.json(messages, "addressed_check", SCHEMA, ADDRESSED_MAX_TOKENS), timeout_s)
        label = str((data or {}).get("addressed") or "").strip().lower()
        confidence = float((data or {}).get("confidence"))
        if label in ADDRESSED_VALUES:
            if raw is not None:
                raw["label"] = label
            if label in ("thinking_aloud", "reading_problem") and (is_strong_request(text) or is_ask_cue(text)):
                label = "unclear"           # the model placed an ask as talk to themselves: it is checked in on, never silenced
            return ("unclear" if confidence < ADDRESSED_THRESHOLD else label), confidence, "model"   # type: ignore[return-value]
        logger.warning("addressed check outside the four values: %r", label)
    except Exception as exc:  # noqa: BLE001 - a check that cannot be made never blocks the reply
        logger.warning("addressed check failed: %s: %s", type(exc).__name__, exc)
    return lean(text, since_problem_s=since_problem_s, overlaps_problem=overlaps_problem, on_problem=on_problem), 0.0, "fallback"


@dataclass
class AddressedState:
    checkin_used: set[str] = field(default_factory=set)    # items (problems) already checked in on: one check-in per item
    thinking_items: set[str] = field(default_factory=set)  # items where the candidate said they are thinking: stay quiet there
    reading_said: set[str] = field(default_factory=set)    # items where the reading remark was said
    direct_only_items: set[str] = field(default_factory=set)   # items where the interviewer invited questions: only a specific ask is answered there
    checkin_at: float | None = None
    checkin_item: str | None = None
    nudged: bool = False
    ask_armed_until: float | None = None

    def to_dict(self) -> dict:
        return {"checkin_used": sorted(self.checkin_used), "thinking_items": sorted(self.thinking_items), "reading_said": sorted(self.reading_said),
                "direct_only_items": sorted(self.direct_only_items),
                "checkin_at": self.checkin_at, "checkin_item": self.checkin_item, "nudged": self.nudged, "ask_armed_until": self.ask_armed_until}

    @classmethod
    def from_dict(cls, d: dict | None) -> "AddressedState":
        d = d or {}
        return cls(checkin_used=set(d.get("checkin_used") or ()), thinking_items=set(d.get("thinking_items") or ()),
                   reading_said=set(d.get("reading_said") or ()), direct_only_items=set(d.get("direct_only_items") or ()), checkin_at=d.get("checkin_at"), checkin_item=d.get("checkin_item"),
                   nudged=bool(d.get("nudged", False)), ask_armed_until=d.get("ask_armed_until"))
