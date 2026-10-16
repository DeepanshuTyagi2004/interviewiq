"""One talker turn (spec §5.1), independent of LiveKit: stream the reply from OpenRouter, pass each
sentence through the leak guard before it is spoken, then run the turn's tool calls. A `look_at_board`
call adds a second generation that sees the whiteboard. Tools run only if the reply wasn't cut off.

A slow model never leaves the candidate in silence: if the first model has not produced a token after
`hedge_after_s`, the fallback model is raced against it (whichever speaks first wins, the other is cancelled),
and the interviewer says short fillers in stages while the wait grows (see fillers.py)."""
from __future__ import annotations

import asyncio
import base64
import re
import time
from contextlib import aclosing
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Callable

from app.interviewer.closing import announces_coding_now, announces_problem, invites_clarifying, invites_questions_now
from app.interviewer.fillers import Fillers
from app.interviewer.guard import LeakGuard
from app.interviewer.llm import LLMUnavailable, StreamEvent, ToolCall
from app.interviewer.said import LOOP_AT, SaidTracker
from app.interviewer.tools import TOOLS, ToolExecutor

SENTENCE_END = re.compile(r"(?<=[.!?])\s+")
# Saying a problem is on their screen when none may be shown (the background questions): a promise the candidate would wait on.
# A sentence the model broke off and "corrected" mid-way ("it returns false, no wait, strats... sorry, ...") is a glitch, not speech.
GARBLED = re.compile(r"\bno,? wait\b|\bwait,? no\b|\w(?:\.\.\.|…)\s*(?:sorry|no|I mean)\b|\bsorry,? (?:I mean|strings|that's not)\b", re.IGNORECASE)
# "You found it yourself": the interviewer chose the test input or asked the leading question that led there, so the credit is never theirs to give.
UNEARNED_CREDIT = re.compile(
    r"\b(?:caught|found|spotted|figured|worked|reasoned|got|came|noticed|saw|fixed|solved)\b[^.?!]{0,50}\b(?:yourself|on your own|without (?:me|any (?:help|hint|nudge)|a hint|a nudge|pointing))\b|"
    r"\bwithout me (?:pointing|saying|telling|helping)\b|\bon your own\b", re.IGNORECASE)
# The interviewer's own machinery ("it's the case from my earlier brief") is never said aloud. Ordinary words stay: a hash table's "slot",
# "a brief summary", "the director of the team", "your plan".
HINT_CUE = re.compile(r"\b(?:keep in mind|bear in mind|think about|consider|remember (?:to|that)|what if|how about|hint|make sure|don't forget|watch out|be careful)\b",
                      re.IGNORECASE)
INTERNAL_WORDS = re.compile(
    r"\b(?:blueprint|playbook|conductor|timebox|answer key|hint ladder)\b|\bthe director (?:says|wants|told|ordered|has)\b|"
    r"\b(?:core|reserve)-(?:\d|harder|alternate)\b|\b(?:name|string|arguments|parameter)=\"|</?\s*(?:tool|function|invoke|parameter)|"
    r"\b(?:my|our|the|this|that)\s+(?:earlier |original |prepared |internal )?brief\b(?!\s+(?:version|answer|summary|explanation|description|overview|look|introduction|history|moment|pause|note|reply|response|walk))",
    re.IGNORECASE)
SCREEN_CLAIM = re.compile(r"\bhere(?:'s| is) your (?:first|second|third|next) (?:question|problem)\b|\b(?:on|up on|onto) (?:your|the) screen\b|\bput (?:it|the problem|that|one) (?:up|on)\b|\bpull (?:it|the problem) up\b|\bhave a read\b|\bread (?:it|through it|the problem)\b|\btake a moment to read\b|"
                          r"\b(?:jump|get|move|dive|go|turn)\s+(?:on\s+)?(?:in)?to\s+(?:the|a|our)\s+(?:(?:coding|first|actual|technical)\s+(?:problem|part|question|exercise)|(?:problems?|exercise))\b|"
                          r"\b(?:start|begin|do|tackle)\s+(?:the|a|our)\s+(?:(?:coding\s+)?(?:problem|exercise)|coding\s+part)\b", re.IGNORECASE)
VALUES_ALOUD = re.compile(r"\d|\b(?:hundred|thousand|million|billion|zero)\b", re.IGNORECASE)
# Claims about what is on their screen that the interviewer cannot know (it sees the problem it showed, their code and a digest of the pointer).
SCREEN_GUESS = re.compile(r"\b(?:whatever|what(?:ever)?) you(?:'re| are| have|'ve) (?:seeing|looking at|highlighted|selected)\b|"
                          r"\bwhat(?:ever)? you (?:highlighted|selected)\b", re.IGNORECASE)
ASKS_RESTATE = re.compile(r"\b(?:restate|re-state|(?:hear|say|tell me|give me) (?:it|the problem|that)? ?back|back in your own words|\bproblem\b[^.?!]{0,30}\bin your (?:own )?words|\bin your (?:own )?words\b[^.?!]{0,30}\bproblem\b|\bhear(?:d)? the problem\b|\bunderstood the problem\b|\bunderstanding of the problem\b|say (?:it|the problem|that) back|repeat (?:the|that) problem|(?:put|say) (?:the problem|it|that) in your own words)\b", re.IGNORECASE)
INSIGHT_PRAISE = re.compile(r"\b(?:that'?s|exactly|precisely) (?:exactly |precisely )?the (?:idea|insight|key)\b|\bthat'?s the (?:right|key) (?:idea|insight)\b", re.IGNORECASE)
VERDICT = re.compile(r"^\W*(?:yes|right|exactly|correct|perfect|great|good|nice|well done)\b|\b(?:that'?s (?:right|correct|exactly|it)|is correct|looks (?:right|correct)|spot on)\b", re.IGNORECASE)
ASKS_CODE_AGAIN = re.compile(r"\bimplement\b|\blet'?s see (?:it|that) as code\b|\bwrite (?:out )?(?:the|your|a) (?:whole |full )?(?:function|solution|code)\b", re.IGNORECASE)
ANNOUNCES_SILENCE = re.compile(r"\bi(?:'ll| will|'m going to) (?:stay|keep|be) (?:quiet|silent)\b|\bi(?:'ll| will) (?:just )?(?:be )?watch(?:ing)?\b|"
                               r"\bi(?:'ll| will) (?:let you|leave you to)\b", re.IGNORECASE)
GO_AHEAD = re.compile(r"\bgo ahead and (?:start |begin )?(?:writ|cod|typ)\w*|\bstart (?:writing|coding)\b", re.IGNORECASE)
TAKE_YOUR_TIME = re.compile(r"\btake your time\b", re.IGNORECASE)
# Time pressure the round does not have: a live round said "we're nearly out of time" at ten minutes of 45 (the director scripted it).
TIME_PRESSURE = re.compile(r"\b(?:(?:nearly|almost|running|about|close to) out of time|out of time|short (?:on|of) time|(?:running|run|pressed) (?:short|low) "
                           r"(?:on|of) time|tight on time|(?:not|isn'?t) (?:much|a lot of) time(?: left)?|(?:little|limited) time left|time is (?:almost |nearly )?up|"
                           r"coming up on (?:time|the end)|(?:nearly|almost) (?:at|out of) (?:time|the end))\b", re.IGNORECASE)
# A verdict on the whole interview ("the clearest thing you gave today"): the report gives that, never the interviewer.
ROUND_VERDICT = re.compile(r"\b(?:clearest|best|strongest|weakest)\b[^.?!]{0,50}\b(?:you(?:'ve)? (?:gave|given|said|shown|showed|did|done)|today|"
                           r"in this (?:interview|round))\b|\byou(?:'ve)? (?:did|done|been doing) (?:really |very |pretty )?(?:well|great|good|fine)\b"
                           r"[^.?!]{0,30}\b(?:today|so far|overall|in this (?:interview|round))\b|\b(?:overall|all in all),? you(?:'ve)? (?:did|done)\b",
                           re.IGNORECASE)
RE_INTRODUCES = re.compile(r"^\W*(?:hi|hello|hey)\b[^.?!]{0,20}\b(?:i'?m|i am|my name is)\b", re.IGNORECASE)
UNHEARD = re.compile(r"\byou (?:mentioned|said|told me|talked about|described|brought up|spoke about)\b([^.?!]{0,140})", re.IGNORECASE)
_INDEX = re.compile(r"\b([A-Za-z_]\w*)\[([^\[\]]{1,40})\]")
_METHOD = re.compile(r"\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\(\)")


def speakable(text: str) -> str:
    """Code in a sentence as a person would say it: "prices[i - 1]" is "prices at i minus 1", never "pricesi - 1"."""
    def index(m: "re.Match[str]") -> str:
        inner = re.sub(r"\s*-\s*", " minus ", re.sub(r"\s*\+\s*", " plus ", m.group(2).strip()))
        return f"{m.group(1)} at {inner}"
    return _METHOD.sub(r"\1 dot \2", _INDEX.sub(index, text))


_COMPOUND_Q = re.compile(r",?\s+and\s+(?:then\s+|also\s+)?(?=(?:what|how|where|when|why|which|who|does|do|did|is|are|can|could|would|will|should|tell|walk|explain|describe|show)\b)", re.IGNORECASE)
_IMPERATIVE_ASK = re.compile(r"^(?:(?:now|then|so|okay|alright|and),?\s+)?(?:walk|tell|talk|explain|describe|show|trace|dry)\b", re.IGNORECASE)
_IMPERATIVE_JOIN = re.compile(r",?\s+(?:and|then)\s+(?=(?:tell|walk|explain|describe|show|finish|run|trace|write|give|say|what|how|where)\b)", re.IGNORECASE)


def one_ask(text: str) -> str:
    """A sentence that asks two things ("what is added, and what does the total come to?") keeps its first ask: they answer the last part of a
    double question and skip the rest, so the second is asked on its own turn."""
    t = text.strip()
    if t.endswith("?"):
        m = _COMPOUND_Q.search(t)
        if m and len(t[:m.start()].split()) >= 4:
            return t[:m.start()].rstrip(",") + "?"
    elif _IMPERATIVE_ASK.match(t):
        m = _IMPERATIVE_JOIN.search(t)
        if m and len(t[:m.start()].split()) >= 4:
            return t[:m.start()].rstrip(",") + "."
    return t


def _overlap(a: str, b: str) -> float:
    wa, wb = set(re.findall(r"[a-z]{4,}", a.lower())), set(re.findall(r"[a-z]{4,}", b.lower()))
    return len(wa & wb) / min(len(wa), len(wb)) if min(len(wa), len(wb)) >= 4 else 0.0


def _clean(text: str) -> str:
    text = re.sub(r"(?<=[A-Za-z0-9])_+(?=[A-Za-z0-9])", " ", text)    # DENSE_RANK is spoken "DENSE RANK", not "DENSERANK"
    return re.sub(r"\s+", " ", MARKUP.sub("", text)).strip()      # stray markdown or tag characters are never spoken


THIRD_PERSON = re.compile(r"^\s*the candidate\b", re.IGNORECASE)    # the interviewer speaks to them, never about them
SILENT = "<silent>"
MARKUP = re.compile(r"[<>{}\[\]|`*_~^#]")
FILLER_AT = (1.15, 2.65, 4.65, 7.3)   # when each filler stage is said, as a multiple of the hedge time
DEADLINE_FACTOR = 10.5


@dataclass(frozen=True)
class Pacing:
    """How long the talker waits for a first token, and what it does meanwhile (seconds)."""
    hedge_after_s: float = 3.0
    filler_after_s: tuple[float, ...] = (3.5, 8.0, 14.0, 22.0)
    deadline_s: float = 32.0
    max_attempts: int = 4
    retry_gap_s: float = 0.3      # before asking the same model again after it failed at once

    @classmethod
    def scaled(cls, hedge_after_s: float) -> "Pacing":
        return cls(hedge_after_s=hedge_after_s, filler_after_s=tuple(round(hedge_after_s * f, 3) for f in FILLER_AT),
                   deadline_s=hedge_after_s * DEADLINE_FACTOR, retry_gap_s=round(hedge_after_s * 0.1, 3))


class TalkerFailed(Exception):
    """No model produced a reply within the deadline."""


@dataclass
class TurnResult:
    spoken: list[str] = field(default_factory=list)
    blocked: list[dict[str, Any]] = field(default_factory=list)
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    decision: dict[str, Any] | None = None
    first_token_ms: int | None = None
    usage: dict[str, Any] = field(default_factory=dict)
    provider: str | None = None
    interrupted: bool = False
    error: str | None = None
    model: str | None = None       # the model that answered
    hedged: bool = False           # the fallback (or a second request) was raced against a slow first one
    fillers: int = 0               # filler lines spoken while waiting
    attempts: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class _Opened:
    stream: Any
    first: StreamEvent
    chat: Any


class TalkerTurn:
    def __init__(self, chat, guard: LeakGuard, tools: ToolExecutor, first_token_timeout_s: float,
                 clock: Callable[[], float] = time.perf_counter, *, fallback=None, pacing: Pacing | None = None,
                 on_slow: Callable[[bool], None] | None = None, fillers: Fillers | None = None) -> None:
        self.chat = chat
        self.fallback = fallback
        self.guard = guard
        self.tools = tools
        self.pacing = pacing or Pacing.scaled(first_token_timeout_s)
        self.clock = clock
        self.on_slow = on_slow
        self.fillers = fillers or Fillers()
        self.said = SaidTracker()                   # every sentence spoken this interview: none is said again in the same words
        self._turn_id = ""
        self.last = TurnResult()
        self._offered = TOOLS
        self._block_claims = False
        self._block_qa = False
        self._fillers_on = True
        self._quiet = False
        self._block_values = False
        self._block_clarify = False
        self._heard = ""
        self._hint_step = 0
        self._has_code = False
        self._time_talk_ok = True
        self._verdicts = 0
        self._questions = 0
        self._remarks = 0

    async def run(self, messages: list[dict[str, Any]], *, turn_id: str, current_slot: str | None,
                  candidate_said: str, tools: list[dict[str, Any]] | None = None, block_screen_claims: bool = False,
                  neutral_on_blocked: bool = True, block_qa_invites: bool = False, fillers_allowed: bool = True,
                  quiet_coding: bool = False, block_values: bool = False,
                  block_clarify: bool = False, heard: str = "", hint_step: int = 0, has_code: bool = False,
                  time_talk_ok: bool = True) -> AsyncIterator[str]:
        self._offered = tools if tools is not None else TOOLS
        self._turn_id = turn_id
        self._block_claims = block_screen_claims
        self._block_qa = block_qa_invites
        self._block_clarify = block_clarify         # a problem is on screen: it already invited their questions, once
        self._hint_step = hint_step                 # hints already given: their words may be used again
        self._has_code = has_code                   # they have written code: never ask them to write it
        self._time_talk_ok = time_talk_ok           # the round really is short of time: only then may it be said
        self._verdicts = 0                          # sentences that judge what they said, in this turn: at most one
        self._heard = heard.lower()                 # everything the candidate has said, for "you mentioned..." claims
        self._questions = 0                         # question sentences spoken in this turn: one question per turn
        self._block_values = block_values           # they asked for the constraints: they go on the screen, never into speech
        self._quiet = quiet_coding                  # they are about to type: one short remark at most, never a hint
        self._remarks = 0
        self._fillers_on = fillers_allowed          # off for the greeting: nobody has asked for anything, so "give me a second" means nothing
        result = TurnResult()
        self.last = result
        started = self.clock()
        calls: list[ToolCall] = []
        try:
            async with aclosing(self._generate(messages, result, started, calls, current_slot, candidate_said,
                                               with_tools=True)) as sentences:
                async for sentence in sentences:
                    yield sentence
            image: bytes | None = None
            # next_item first: the model often lists show_problem before the next_item that makes it valid, and the
            # candidate should still see the problem (stable sort keeps every other call in the order it was made).
            for call in sorted(calls, key=lambda c: c.name != "next_item"):
                if call.name == "log_turn":
                    result.decision = {k: call.arguments.get(k) for k in ("condition", "action", "reason")}
                    continue
                outcome = await self.tools.execute(call, turn_id)
                result.tool_calls.append({"name": call.name, "arguments": call.arguments,
                                          "result": {k: v for k, v in outcome.items() if k != "image"}})
                if call.name == "look_at_board" and outcome.get("image"):
                    image = outcome["image"]
            if image is not None:
                follow = [*messages,
                          {"role": "assistant", "content": " ".join(result.spoken) or "Let me take a look."},
                          {"role": "user", "content": [
                              {"type": "text", "text": "(The whiteboard as it looks now. React in one or two spoken sentences.)"},
                              {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(image).decode()}}]}]
                async with aclosing(self._generate(follow, result, started, [], current_slot, candidate_said,
                                                   with_tools=False)) as sentences:
                    async for sentence in sentences:
                        yield sentence
            if neutral_on_blocked and not result.spoken and result.blocked:
                line = self.said.neutral()
                result.spoken.append(line)
                yield line
        except (asyncio.CancelledError, GeneratorExit):
            result.interrupted = True
            self.said.forget(turn_id)               # they may not have heard it to the end: it can be said again
            raise

    async def _try(self, chat, messages, with_tools: bool, limit_s: float) -> _Opened:
        """One request, up to its first event. Closes the stream if it fails or is cancelled."""
        stream = chat.stream(messages, tools=self._offered if with_tools else None)
        try:
            first = await asyncio.wait_for(stream.__anext__(), timeout=limit_s)
        except BaseException:
            await stream.aclose()
            raise
        return _Opened(stream, first, chat)

    def _note_slow(self, slow: bool) -> None:
        if self.on_slow is not None:
            try:
                self.on_slow(slow)
            except Exception:  # noqa: BLE001 - a status light must never break a turn
                pass

    async def _opening(self, messages, with_tools: bool, result: TurnResult) -> AsyncIterator[str | _Opened]:
        """Yield filler lines while waiting, then the opened stream of whichever model spoke first."""
        pace = self.pacing
        loop = asyncio.get_running_loop()
        began = loop.time()
        chats = [self.chat] + ([self.fallback] if self.fallback is not None else [])
        tasks: dict[asyncio.Task, tuple[Any, float]] = {}
        started = 0
        next_hedge = pace.hedge_after_s
        stage = 0
        last_failure = float("-inf")
        failed_chat: Any = None
        winner: _Opened | None = None
        errors: list[str] = []

        def launch() -> None:
            nonlocal started
            chat = chats[started % len(chats)]
            remaining = max(0.01, pace.deadline_s - (loop.time() - began))
            task = asyncio.ensure_future(self._try(chat, messages, with_tools, remaining))
            tasks[task] = (chat, loop.time())
            started += 1

        launch()
        try:
            while winner is None:
                now = loop.time() - began
                if now >= pace.deadline_s:
                    break
                if stage < len(pace.filler_after_s) and now >= pace.filler_after_s[stage]:
                    if stage == 0:
                        self._note_slow(True)
                    stage += 1
                    if self._fillers_on:
                        line = self.fillers.line(stage - 1)
                        result.fillers = stage
                        result.spoken.append(line)
                        yield line
                    continue
                # After a failure the other model is asked at once; the same model again only after a short pause.
                retry_ready = not tasks and (chats[started % len(chats)] is not failed_chat or loop.time() - last_failure >= pace.retry_gap_s)
                if started < pace.max_attempts and ((now >= next_hedge and len(tasks) < 2) or retry_ready):
                    result.hedged = result.hedged or bool(tasks)
                    launch()
                    next_hedge = now + pace.hedge_after_s
                if not tasks and started >= pace.max_attempts:
                    break
                wakes = [pace.deadline_s]
                if stage < len(pace.filler_after_s):
                    wakes.append(pace.filler_after_s[stage])
                if started < pace.max_attempts:
                    wakes.append(next_hedge if tasks else last_failure - began + pace.retry_gap_s)
                wait = max(0.0, min(wakes) - (loop.time() - began))
                if tasks:
                    done, _ = await asyncio.wait(set(tasks), timeout=wait, return_when=asyncio.FIRST_COMPLETED)
                else:
                    await asyncio.sleep(wait)
                    done = set()
                for task in done:
                    chat, at = tasks.pop(task)
                    elapsed_ms = int((loop.time() - at) * 1000)
                    try:
                        opened = task.result()
                    except (TimeoutError, LLMUnavailable, StopAsyncIteration) as exc:
                        last_failure, failed_chat = loop.time(), chat
                        errors.append(f"{type(exc).__name__}: {exc}")
                        result.attempts.append({"model": getattr(chat, "model", None), "ms": elapsed_ms, "ok": False,
                                                "error": type(exc).__name__})
                        continue
                    result.attempts.append({"model": getattr(chat, "model", None), "ms": elapsed_ms, "ok": True})
                    if winner is None:
                        winner = opened
                    else:
                        await opened.stream.aclose()
        finally:
            for task in tasks:
                task.cancel()
            for outcome in await asyncio.gather(*tasks, return_exceptions=True):
                if isinstance(outcome, _Opened):     # it finished in the same instant: close it
                    await outcome.stream.aclose()
        if winner is None:
            result.error = errors[-1] if errors else "TimeoutError: no model answered in time"
            if result.fillers == 0 and self._fillers_on:
                line = self.fillers.line(0)           # never leave the candidate with nothing at all
                result.fillers = 1
                result.spoken.append(line)
                yield line
            raise TalkerFailed(result.error)
        result.model = getattr(winner.chat, "model", None)
        yield winner

    async def _generate(self, messages, result: TurnResult, started: float, calls: list[ToolCall],
                        current_slot: str | None, candidate_said: str, *, with_tools: bool) -> AsyncIterator[str]:
        opened: _Opened | None = None
        stages_said = result.fillers
        async with aclosing(self._opening(messages, with_tools, result)) as steps:
            async for step in steps:
                if isinstance(step, _Opened):
                    opened = step
                else:
                    yield step                        # a filler line, already recorded in result.spoken
        assert opened is not None
        if result.fillers and stages_said == 0:
            self._note_slow(False)
        stream, first = opened.stream, opened.first
        # Said once, before the first real sentence, when a filler was spoken: "There." or an apology.
        recovery = self.fillers.recovery(result.fillers) if result.fillers and stages_said == 0 else None

        async def events():
            try:
                yield first
                async for event in stream:
                    yield event
            finally:
                await stream.aclose()

        buffer = ""
        try:
            async with aclosing(events()) as incoming:
                async for event in incoming:
                    if event.kind == "text":
                        if result.first_token_ms is None:
                            result.first_token_ms = int((self.clock() - started) * 1000)
                        buffer += event.text
                        *done, buffer = SENTENCE_END.split(buffer)
                        for sentence in done:
                            if (out := self._check(sentence, result, current_slot, candidate_said)) is not None:
                                if recovery:
                                    result.spoken.insert(len(result.spoken) - 1, recovery)
                                    yield recovery
                                    recovery = None
                                yield out
                    elif event.kind == "tool_call" and event.tool_call is not None:
                        calls.append(event.tool_call)
                    elif event.kind == "done":
                        result.usage, result.provider = event.usage, event.provider
        except LLMUnavailable as exc:
            result.error = str(exc)  # a broken stream mid-reply: keep what was already spoken
        if (out := self._check(buffer, result, current_slot, candidate_said)) is not None:
            if recovery:
                result.spoken.insert(len(result.spoken) - 1, recovery)
                yield recovery
            yield out

    def _check(self, sentence: str, result: TurnResult, current_slot: str | None, candidate_said: str) -> str | None:
        text = sentence.strip()
        if not text or text == SILENT:
            return None
        original = text
        text = _clean(text)
        if not re.search(r"[A-Za-z0-9]", text):
            return None
        if ASKS_RESTATE.search(text):
            result.blocked.append({"sentence": text, "rule": "asks_restate", "match": ASKS_RESTATE.search(text).group(0)})
            return None
        if ANNOUNCES_SILENCE.search(text):
            result.blocked.append({"sentence": text, "rule": "announces_silence", "match": ANNOUNCES_SILENCE.search(text).group(0)})
            return None
        if GO_AHEAD.search(text) and self.said.has(GO_AHEAD):
            result.blocked.append({"sentence": text, "rule": "repeat_instruction", "match": GO_AHEAD.search(text).group(0)})
            return None
        if TAKE_YOUR_TIME.search(text) and self.said.has(TAKE_YOUR_TIME):
            result.blocked.append({"sentence": text, "rule": "repeat_instruction", "match": "take your time"})
            return None
        if not self._time_talk_ok and TIME_PRESSURE.search(text):
            result.blocked.append({"sentence": text, "rule": "time_claim", "match": TIME_PRESSURE.search(text).group(0)})
            return None
        if ROUND_VERDICT.search(text):
            result.blocked.append({"sentence": text, "rule": "round_verdict", "match": ROUND_VERDICT.search(text).group(0)})
            return None
        if self._fillers_on and RE_INTRODUCES.search(text):
            result.blocked.append({"sentence": text, "rule": "reintroduces", "match": "introduces themselves again"})
            return None
        if self._heard and (m := UNHEARD.search(text)) is not None:
            topic = {w for w in re.findall(r"[a-z]{5,}", m.group(1).lower())}
            names = {w.lower() for w in re.findall(r"\b[A-Z][a-z]{3,}\b", m.group(1))}      # "Experience Portal": names they must have said
            if (topic and not any(w in self._heard for w in topic)) or any(w not in self._heard for w in names):
                result.blocked.append({"sentence": text, "rule": "unheard_claim", "match": m.group(0)[:60]})
                return None
        if text.rstrip().endswith("?") and self._questions >= 1:
            result.blocked.append({"sentence": text, "rule": "one_question", "match": "a second question in the same turn"})
            return None
        if THIRD_PERSON.search(text):
            result.blocked.append({"sentence": text, "rule": "internal_words", "match": "speaks about the candidate in the third person"})
            return None
        if SCREEN_GUESS.search(text):
            result.blocked.append({"sentence": text, "rule": "screen_guess", "match": SCREEN_GUESS.search(text).group(0)})
            return None
        if self._block_clarify and invites_clarifying(text):
            result.blocked.append({"sentence": text, "rule": "questions_repeated", "match": "invites their questions again"})
            return None
        if self._block_values and VALUES_ALOUD.search(text):
            result.blocked.append({"sentence": text, "rule": "values_aloud", "match": VALUES_ALOUD.search(text).group(0)})
            return None
        if INTERNAL_WORDS.search(text):
            result.blocked.append({"sentence": text, "rule": "internal_words", "match": INTERNAL_WORDS.search(text).group(0)})
            return None
        if UNEARNED_CREDIT.search(text):
            result.blocked.append({"sentence": text, "rule": "credit_unearned", "match": "credits them with finding it themselves"})
            return None
        if GARBLED.search(text) or text.startswith("sorry"):         # a lowercase "sorry," is the tail of a sentence that broke off
            result.blocked.append({"sentence": text, "rule": "garbled", "match": "breaks off and corrects itself"})
            return None
        if self._block_claims and (SCREEN_CLAIM.search(text) or announces_problem(text) or announces_coding_now(text)):
            hit = SCREEN_CLAIM.search(text)
            result.blocked.append({"sentence": text, "rule": "screen_claim", "match": hit.group(0) if hit else "problem announced"})
            return None
        if self._block_qa and invites_questions_now(text):
            result.blocked.append({"sentence": text, "rule": "questions_too_early", "match": "invites their questions"})
            return None
        verdict = self.guard.check_sentence(text, current_slot=current_slot, candidate_said=candidate_said)
        if not verdict.ok:
            result.blocked.append({"sentence": text, "rule": verdict.rule, "match": verdict.match})
            return None
        if len(again := self.said.question_loop(text)) >= LOOP_AT:
            result.blocked.append({"sentence": text, "rule": "question_loop", "match": again[-1]})
            return None
        v2 = self.guard.check_insight(text, current_slot=current_slot, candidate_said=candidate_said, hint_step=self._hint_step)
        if not v2.ok or INSIGHT_PRAISE.search(text):
            result.blocked.append({"sentence": text, "rule": "insight_completed", "match": v2.match or INSIGHT_PRAISE.search(text).group(0)})
            return None
        if self._has_code and ASKS_CODE_AGAIN.search(text):
            result.blocked.append({"sentence": text, "rule": "asks_code_again", "match": ASKS_CODE_AGAIN.search(text).group(0)})
            return None
        if any(_overlap(text, prev) >= 0.6 for prev in result.spoken):
            result.blocked.append({"sentence": text, "rule": "repeat_in_turn", "match": "says again what this turn already said"})
            return None
        if VERDICT.search(text):
            if self._verdicts >= 1:
                result.blocked.append({"sentence": text, "rule": "second_verdict", "match": "a second verdict in the same turn"})
                return None
            self._verdicts += 1
        if (earlier := self.said.repeat_of(text)) is not None:
            result.blocked.append({"sentence": text, "rule": "repeat", "match": earlier})
            return None
        if self._quiet:
            if HINT_CUE.search(text):
                result.blocked.append({"sentence": text, "rule": "hint_while_typing", "match": HINT_CUE.search(text).group(0)})
                return None
            if self._remarks >= 1:
                return None                      # one short remark is enough while they type: the rest is dropped, not held against it
            self._remarks += 1
        if text.rstrip().endswith("?"):
            self._questions += 1
        spoken = one_ask(_clean(speakable(original)) or text)      # what the voice says: code read as a person says it, one ask per sentence
        result.spoken.append(spoken)
        self.said.add(spoken, self._turn_id)
        return spoken
