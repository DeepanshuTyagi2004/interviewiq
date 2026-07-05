"""The assumed transport/voice interface (spec §3). The live brain talks to the outside world only
through Transport: say a line, await the next candidate utterance, end the session. The real LiveKit
+ STT/TTS adapter (sub-projects A + D) implements this later; ScriptedTransport is the test double
that drives the brain deterministically with no audio."""
from __future__ import annotations

import asyncio
from typing import Awaitable, Callable, Protocol, runtime_checkable

from app.interview_agent.types import Artifact, ArtifactKind, UtteranceTiming

SILENCE_TIMEOUT_S = 45.0


@runtime_checkable
class Transport(Protocol):
    async def say(self, text: str) -> None: ...
    async def next_utterance(self) -> tuple[str, UtteranceTiming] | None: ...
    async def current_artifact(self) -> Artifact | None: ...
    async def end_session(self) -> None: ...


class ScriptedTransport:
    """Feeds a fixed list of candidate utterances; returns None once exhausted (models a silence /
    disconnect). Records every line the interviewer says + whether the session was ended."""

    def __init__(self, script: list[tuple[str, UtteranceTiming]], artifact: Artifact | None = None):
        self._script = list(script)
        self._i = 0
        self.said: list[str] = []
        self.ended = False
        self._artifact = artifact

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


_PAUSE_EVENTS = {"fullscreen_exit", "tab_hidden", "external_display", "overlay_tamper"}
_RESUME_EVENTS = {"fullscreen_restored", "tab_visible"}


class LiveKitTransport:
    """Real transport for sub-project A: everything is TEXT over a LiveKit room's data channel
    (audio/STT/TTS is sub-project D). Does not import the LiveKit SDK — it is constructed with the
    room (used only for identity/logging by the worker) plus an injected async `send(payload)` that
    publishes a JSON message, and it exposes `handle_incoming`/`set_ended_reason` for the worker to
    wire to the room's data_received event and session teardown, respectively. This keeps the class
    unit-testable with a fake `send` and no real room."""

    def __init__(self, room: object, *, send: Callable[[dict], Awaitable[None]]):
        self._room = room
        self._send = send
        self._queue: asyncio.Queue[tuple[str, UtteranceTiming]] = asyncio.Queue()
        self._latest_artifact: Artifact | None = None
        self._not_paused = asyncio.Event()
        self._not_paused.set()
        self._ended_reason: str | None = None

    def set_ended_reason(self, reason: str) -> None:
        self._ended_reason = reason

    async def handle_incoming(self, payload: dict) -> None:
        msg_type = payload["type"]
        if msg_type == "answer":
            timing = UtteranceTiming(t_start=payload["tStart"], t_end=payload["tEnd"], time_to_first_word_s=0.0)
            await self._queue.put((payload["text"], timing))
        elif msg_type == "artifact":
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
                await self._send({"type": "resume"})

    async def say(self, text: str) -> None:
        await self._send({"type": "speaking", "who": "interviewer", "speaking": True})
        await self._send({"type": "interviewer_utterance", "text": text})
        await self._send({"type": "speaking", "who": "interviewer", "speaking": False})

    async def next_utterance(self) -> tuple[str, UtteranceTiming] | None:
        await self._not_paused.wait()
        try:
            return await asyncio.wait_for(self._queue.get(), timeout=SILENCE_TIMEOUT_S)
        except asyncio.TimeoutError:
            return None

    async def current_artifact(self) -> Artifact | None:
        return self._latest_artifact

    async def end_session(self) -> None:
        await self._send({"type": "ended", "reason": self._ended_reason or "natural_complete"})
