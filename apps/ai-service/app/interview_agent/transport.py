"""The assumed transport/voice interface (spec §3). The live brain talks to the outside world only
through Transport: say a line, await the next candidate utterance, end the session. The real LiveKit
+ STT/TTS adapter (sub-projects A + D) implements this later; ScriptedTransport is the test double
that drives the brain deterministically with no audio."""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Awaitable, Callable, Protocol, runtime_checkable

from app.interview_agent.types import Artifact, ArtifactKind, UtteranceTiming

SILENCE_TIMEOUT_S = 45.0
PAUSE_MAX_S = 300.0

logger = logging.getLogger(__name__)


@runtime_checkable
class Transport(Protocol):
    async def say(self, text: str) -> None: ...
    async def next_utterance(self) -> tuple[str, UtteranceTiming] | None: ...
    async def current_artifact(self) -> Artifact | None: ...
    async def end_session(self) -> None: ...
    def seconds_since_activity(self) -> float: ...


class ScriptedTransport:
    """Feeds a fixed list of candidate utterances; returns None once exhausted (models a silence /
    disconnect). A scripted entry may itself be `None` to model an explicit mid-interview silence
    window without ending the script — a real utterance can still follow it. Records every line the
    interviewer says + whether the session was ended.

    Task 7: `activity` backs `seconds_since_activity()` with a controllable source so driver tests
    can simulate idle-vs-coding silence — a float is a constant reading, a list is consumed one
    value per call (the last value repeats once exhausted). Defaults to 999.0 (always idle), so
    scripted silences drive the inactivity escalation unless a test says otherwise."""

    def __init__(self, script: list[tuple[str, UtteranceTiming] | None], artifact: Artifact | None = None,
                 activity: float | list[float] = 999.0):
        self._script = list(script)
        self._i = 0
        self.said: list[str] = []
        self.ended = False
        self._artifact = artifact
        self._activity = activity
        self._activity_i = 0

    async def say(self, text: str) -> None:
        self.said.append(text)

    async def next_utterance(self) -> tuple[str, UtteranceTiming] | None:
        if self._i >= len(self._script):
            return None
        item = self._script[self._i]
        self._i += 1
        return item

    async def current_artifact(self) -> Artifact | None:
        return self._artifact

    async def end_session(self) -> None:
        self.ended = True

    def seconds_since_activity(self) -> float:
        if isinstance(self._activity, list):
            idx = min(self._activity_i, len(self._activity) - 1)
            self._activity_i += 1
            return self._activity[idx]
        return self._activity


_PAUSE_EVENTS = {"fullscreen_exit", "tab_hidden", "external_display_detected", "overlay_tamper"}
_RESUME_EVENTS = {"fullscreen_restored", "tab_visible"}


class LiveKitTransport:
    """Real transport for sub-project A: everything is TEXT over a LiveKit room's data channel
    (audio/STT/TTS is sub-project D). Does not import the LiveKit SDK — it is constructed with the
    room (used only for identity/logging by the worker) plus an injected async `send(payload)` that
    publishes a JSON message, and it exposes `handle_incoming`/`mark_disconnected` for the worker to
    wire to the room's data_received and disconnect events, respectively. `end_session()` is
    teardown-only (no message emitted) — the frozen brain's `run_session` calls it from a `finally`
    BEFORE returning its SessionOutcome, so it never has the real end reason; the worker owns the
    authoritative `ended` data-channel message and sends it itself, after `run_session` returns. This
    keeps the class unit-testable with a fake `send` and no real room."""

    def __init__(
        self,
        room: object,
        *,
        send: Callable[[dict], Awaitable[None]],
        speak: Callable[[str], Awaitable[None]] | None = None,
        now: Callable[[], float] = time.monotonic,
    ):
        self._room = room
        self._send = send
        self._speak = speak
        self._now = now
        self._queue: asyncio.Queue[tuple[str, UtteranceTiming]] = asyncio.Queue()
        self._paused_buffer: list[tuple[str, UtteranceTiming]] = []
        self._latest_artifact: Artifact | None = None
        self._not_paused = asyncio.Event()
        self._not_paused.set()
        self._disconnected = asyncio.Event()
        self._last_activity = now()

    def mark_disconnected(self) -> None:
        self._disconnected.set()

    async def handle_incoming(self, payload: dict) -> None:
        try:
            msg_type = payload["type"]
            if msg_type == "answer":
                self._last_activity = self._now()
                timing = UtteranceTiming(t_start=payload["tStart"], t_end=payload["tEnd"], time_to_first_word_s=0.0)
                item = (payload["text"], timing)
                if self._not_paused.is_set():
                    self._queue.put_nowait(item)
                else:
                    self._paused_buffer.append(item)
            elif msg_type == "artifact":
                # Task 7: code/diagram edits ARE activity — a candidate silently writing code is
                # working, not gone. This is the crux of "code != inactivity".
                self._last_activity = self._now()
                self._latest_artifact = Artifact(
                    kind=ArtifactKind(payload["kind"]),
                    content=payload["content"],
                    language=payload.get("language"),
                )
            elif msg_type == "proctor":
                event = payload["event"]
                if event in _PAUSE_EVENTS:
                    self._not_paused.clear()
                    await self._send({"type": "pause", "reason": event})
                    await self._send({"type": "acknowledge_violation", "text": f"Violation detected: {event}. The interview is paused until you resolve this."})
                elif event in _RESUME_EVENTS:
                    self._not_paused.set()
                    for it in self._paused_buffer:
                        self._queue.put_nowait(it)
                    self._paused_buffer.clear()
                    await self._send({"type": "resume"})
        except Exception as exc:  # noqa: BLE001 - fire-and-forget task; never let this raise
            logger.warning("error handling data-channel message %r: %s", payload.get("type"), exc)

    def push_utterance(self, text: str, timing: UtteranceTiming) -> None:
        """Sync entry point for STT-derived candidate turns (sub-project D). Mirrors the `answer`
        branch of `handle_incoming` exactly: pause-gated onto the same queue `next_utterance` drains,
        buffered and flushed on resume otherwise."""
        self._last_activity = self._now()
        item = (text, timing)
        if self._not_paused.is_set():
            self._queue.put_nowait(item)
        else:
            self._paused_buffer.append(item)

    async def send_candidate_utterance(self, text: str) -> None:
        """Echo the candidate's transcribed speech to the browser transcript panel (display only;
        NOT the brain path — that's push_utterance). Sent unconditionally (even while paused): it just
        reflects what STT heard."""
        await self._send({"type": "candidate_utterance", "text": text})

    async def say(self, text: str) -> None:
        await self._send({"type": "speaking", "who": "interviewer", "speaking": True})
        await self._send({"type": "interviewer_utterance", "text": text})
        if self._speak is not None:
            try:
                await self._speak(text)
            except Exception as exc:  # noqa: BLE001 - voice is best-effort over the always-present caption
                logger.warning("TTS speak failed: %s", exc)
        await self._send({"type": "speaking", "who": "interviewer", "speaking": False})

    async def next_utterance(self) -> tuple[str, UtteranceTiming] | None:
        # 1) wait until unpaused OR disconnected (whichever first) -- a disconnect while paused
        # (e.g. candidate leaves during a proctor violation) must not hang forever on the pause gate.
        # Also bounded by PAUSE_MAX_S: a pause with no resume AND no disconnect event (e.g. the
        # disconnect wiring didn't fire) must still terminate rather than hang forever.
        if not self._not_paused.is_set():
            np_task = asyncio.ensure_future(self._not_paused.wait())
            disc_wait_task = asyncio.ensure_future(self._disconnected.wait())
            try:
                await asyncio.wait(
                    {np_task, disc_wait_task}, timeout=PAUSE_MAX_S, return_when=asyncio.FIRST_COMPLETED
                )
            finally:
                for t in (np_task, disc_wait_task):
                    if not t.done():
                        t.cancel()
            if not self._not_paused.is_set() and not self._disconnected.is_set():
                return None  # paused too long with no resume/disconnect — let silence handling take over
        # 2) if disconnected and nothing left to deliver, end promptly
        if self._disconnected.is_set() and self._queue.empty():
            return None
        # 3) otherwise wait for the next answer, racing disconnect, bounded by the silence timeout
        get_task = asyncio.ensure_future(self._queue.get())
        disc_task = asyncio.ensure_future(self._disconnected.wait())
        try:
            done, pending = await asyncio.wait(
                {get_task, disc_task}, timeout=SILENCE_TIMEOUT_S, return_when=asyncio.FIRST_COMPLETED
            )
        finally:
            for t in (get_task, disc_task):
                if not t.done():
                    t.cancel()
        if get_task in done and not get_task.cancelled():
            return get_task.result()
        return None  # disconnected or 45s silence timeout

    async def current_artifact(self) -> Artifact | None:
        return self._latest_artifact

    def seconds_since_activity(self) -> float:
        """Task 7: how long since the candidate last did anything — spoke (answer) or edited
        code/diagram (artifact). The driver uses this to tell genuine inactivity apart from a
        candidate who is silently working."""
        return self._now() - self._last_activity

    async def end_session(self) -> None:
        """Teardown-only: unblock any waiter parked in `next_utterance`. Called from the frozen
        brain's `finally` BEFORE `run_session` returns its SessionOutcome, so it cannot know the real
        end reason — emitting an `ended` message here would always be wrong (see class docstring).
        The worker sends the authoritative `ended` message itself once it has the real outcome."""
        self._disconnected.set()
