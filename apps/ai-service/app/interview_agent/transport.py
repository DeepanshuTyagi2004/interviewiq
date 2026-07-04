"""The assumed transport/voice interface (spec §3). The live brain talks to the outside world only
through Transport: say a line, await the next candidate utterance, end the session. The real LiveKit
+ STT/TTS adapter (sub-projects A + D) implements this later; ScriptedTransport is the test double
that drives the brain deterministically with no audio."""
from __future__ import annotations

from typing import Protocol, runtime_checkable

from app.interview_agent.types import Artifact, UtteranceTiming


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


class LiveKitTransport:
    """STUB — real implementation belongs to sub-projects A (LiveKit rooms/tokens/media) + D
    (STT/TTS choice). Wire once the voice stack is decided; the brain needs no changes."""

    async def say(self, text: str) -> None:                      # pragma: no cover
        raise NotImplementedError("LiveKit transport not implemented — see spec sub-projects A + D")

    async def next_utterance(self) -> tuple[str, UtteranceTiming] | None:   # pragma: no cover
        raise NotImplementedError("LiveKit transport not implemented — see spec sub-projects A + D")

    async def current_artifact(self) -> Artifact | None:          # pragma: no cover
        raise NotImplementedError("LiveKit transport not implemented — see spec sub-projects A + D")

    async def end_session(self) -> None:                         # pragma: no cover
        raise NotImplementedError("LiveKit transport not implemented — see spec sub-projects A + D")
