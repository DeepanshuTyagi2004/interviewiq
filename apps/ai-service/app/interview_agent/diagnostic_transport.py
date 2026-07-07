"""Queue-backed Transport that lets run_session be driven by typed candidate turns in-process.
Two harness clocks: the elapsed session clock (advanced by advance_seconds, returned as
UtteranceTiming.t_end so the brain sets state.elapsed_s -> drives pacing), and the activity
clock (seconds_since_activity, raised by silence windows -> drives inactivity escalation).
Three inbox message types: _TurnInput (spoken), _SILENCE (silent window -> None), _END
(force abort -> DiagnosticSessionAborted)."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass

from app.interview_agent.types import UtteranceTiming, Artifact, ArtifactKind

_ARTIFACT_KIND_DEFAULT = "code"


class DiagnosticSessionAborted(Exception):
    """Raised out of next_utterance when a force-end (_END) is dequeued; propagates out of
    run_session (the brain does not catch it) so the runner can mark the session aborted."""


class _Sentinel:
    def __init__(self, name): self.name = name


_SILENCE = _Sentinel("SILENCE")
_END = _Sentinel("END")


@dataclass
class _TurnInput:
    text: str
    artifact: dict | None
    advance_seconds: float


class DiagnosticTransport:
    def __init__(self, run_id: str, store) -> None:
        self._run_id = run_id
        self._store = store
        self._inbox: "asyncio.Queue" = asyncio.Queue()
        self._clock = 0.0
        self._activity_seconds = 0.0
        self._artifact: Artifact | None = None

    # ---- producer side (called by the /turn, /end endpoints) -------------
    def submit_turn(self, text, artifact, advance_seconds) -> None:
        self._inbox.put_nowait(_TurnInput(text=text, artifact=artifact,
                                          advance_seconds=float(advance_seconds)))

    def submit_silence(self, advance_seconds=60.0) -> None:
        # carry the advance on the sentinel via a tuple so the clock still moves
        self._inbox.put_nowait((_SILENCE, float(advance_seconds)))

    def submit_end(self) -> None:
        self._inbox.put_nowait(_END)

    def inbox_empty(self) -> bool:
        return self._inbox.empty()

    # ---- Transport protocol ---------------------------------------------
    async def say(self, text: str) -> None:
        self._store.append_transcript(self._run_id, "interviewer", text)
        # tts step is recorded by the emitter tap around _say; here we just carry text.

    async def next_utterance(self):
        self._store.set_status(self._run_id, "awaiting_input")
        item = await self._inbox.get()
        self._store.set_status(self._run_id, "running")
        if item is _END:
            raise DiagnosticSessionAborted()
        if isinstance(item, tuple) and item[0] is _SILENCE:
            advance = item[1]
            self._clock += advance
            self._activity_seconds = max(self._activity_seconds, advance, 45.0)
            self._store.open_turn(self._run_id, "silence", None, False,
                                  self._artifact is not None, self._clock)
            return None
        # _TurnInput
        present = item.artifact is not None
        if present:
            self._artifact = Artifact(kind=ArtifactKind(item.artifact.get("kind", _ARTIFACT_KIND_DEFAULT)),
                                      content=item.artifact.get("content", ""))
        elif item.artifact == {}:   # explicit clear
            self._artifact = None
        t_start = self._clock
        self._clock += item.advance_seconds
        self._activity_seconds = 0.0
        self._store.append_transcript(self._run_id, "candidate", item.text)
        self._store.open_turn(self._run_id, "main", item.text, present,
                              self._artifact is not None, self._clock)
        return item.text, UtteranceTiming(t_start=t_start, t_end=self._clock,
                                          time_to_first_word_s=0.0)

    async def current_artifact(self):
        return self._artifact

    async def end_session(self) -> None:
        # brain-initiated end; runner sets terminal status on run_session return.
        return None

    def seconds_since_activity(self) -> float:
        return self._activity_seconds
