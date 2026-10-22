"""How loud the candidate speaks, as evidence for "is that for me?" (decided 2026-10-21, live round 3e574171).

Someone thinking aloud or muttering the problem to themselves speaks more quietly than someone asking the interviewer something. This module
measures each utterance's level from the candidate's microphone track and compares it with that candidate's own usual level. It is evidence only:
a quiet utterance with no ask in it is placed as thinking aloud by `addressed.classify_by_rules`, and the label goes to the model check and the trace.
Everything degrades silently: no track, no frames, any error means the volume is unknown (`None`), and nothing here raises or blocks a reply.
Only the loudness of the audio is kept (a number), never the audio."""
from __future__ import annotations

import asyncio
import logging
import math
import statistics
from typing import Any, Literal

logger = logging.getLogger(__name__)

Volume = Literal["quiet", "normal", "loud"]

NOISE_GATE_DB = -50.0        # frames below this level (dBFS, RMS) are room noise or silence and do not count towards an utterance's level
MIN_VOICED_FRAMES = 15       # an utterance needs this many frames above the gate (about 150 ms at 10 ms frames) to have a level
MIN_BASELINE_UTTERANCES = 3  # the candidate's usual level is only used from this many utterances on
BASELINE_WINDOW = 30         # the usual level is the median of this many latest utterances
QUIET_BELOW_DB = 6.0         # "quiet": at least this far below their usual level (self-talk is typically 6+ dB under addressed speech)
LOUD_ABOVE_DB = 4.0          # "loud": at least this far above their usual level


def frame_db(samples: Any) -> float | None:
    """RMS of one frame of 16-bit samples, in dBFS (0 is full scale); None for an empty or silent frame."""
    try:
        import numpy as np
        arr = np.asarray(samples, dtype=np.float64)
        if arr.size == 0:
            return None
        rms = float(np.sqrt(np.mean(arr * arr))) / 32768.0
        return 20.0 * math.log10(rms) if rms > 0 else None
    except Exception:  # noqa: BLE001 - a frame that cannot be measured is skipped
        return None


class CandidateLoudness:
    """Per-utterance level and the running baseline. `feed` is called per audio frame, `speech_started` when the speech-to-text says they began,
    `finish` when their final transcript arrives (it returns the utterance's mean dBFS or None)."""

    def __init__(self) -> None:
        self._active = False
        self._sum = 0.0
        self._n = 0
        self.levels: list[float] = []          # one mean dBFS per utterance, latest last

    def speech_started(self) -> None:
        if not self._active:
            self._active, self._sum, self._n = True, 0.0, 0

    def feed(self, db: float | None) -> None:
        if self._active and db is not None and db >= NOISE_GATE_DB:
            self._sum += db
            self._n += 1

    def finish(self) -> float | None:
        """End the utterance being measured: its mean level over the frames above the noise gate, or None when it had too few."""
        try:
            active, n, total = self._active, self._n, self._sum
            self._active, self._sum, self._n = False, 0.0, 0
            return total / n if active and n >= MIN_VOICED_FRAMES else None
        except Exception:  # noqa: BLE001
            return None

    def baseline(self) -> float | None:
        if len(self.levels) < MIN_BASELINE_UTTERANCES:
            return None
        return statistics.median(self.levels[-BASELINE_WINDOW:])

    def classify(self, level: float | None) -> Volume | None:
        """quiet / normal / loud against the baseline; None while the level or the baseline is unknown."""
        base = self.baseline()
        if level is None or base is None:
            return None
        if level <= base - QUIET_BELOW_DB:
            return "quiet"
        if level >= base + LOUD_ABOVE_DB:
            return "loud"
        return "normal"

    def record(self, level: float | None) -> None:
        """Add an utterance's level to the baseline (after it was classified, so it never judges itself)."""
        if level is not None:
            self.levels = [*self.levels, level][-BASELINE_WINDOW:]

    def measure(self) -> tuple[float | None, Volume | None]:
        """Finish the utterance, classify it against the earlier ones, then add it to them. Never raises."""
        try:
            level = self.finish()
            volume = self.classify(level)
            self.record(level)
            return level, volume
        except Exception:  # noqa: BLE001
            return None, None


def watch_loudness(room: Any, meter: CandidateLoudness, is_agent: Any) -> None:
    """Feed `meter` from the candidate's microphone track (any remote participant that is not an interviewer). Never raises; with no track the meter stays
    empty and every volume is unknown."""
    try:
        from livekit import rtc
    except Exception as exc:  # noqa: BLE001
        logger.info("loudness off: %s", exc)
        return
    streams: dict[str, asyncio.Task] = {}

    async def _pump(track: Any) -> None:
        try:
            async for event in rtc.AudioStream(track, sample_rate=16000, num_channels=1):
                meter.feed(frame_db(event.frame.data))
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.info("loudness stream ended: %s", exc)

    def _start(track: Any, participant: Any, publication: Any = None) -> None:
        try:
            if getattr(track, "kind", None) != rtc.TrackKind.KIND_AUDIO or is_agent(participant):
                return
            if getattr(publication, "source", None) == rtc.TrackSource.SOURCE_SCREENSHARE_AUDIO:
                return                          # a shared tab's sound is not the candidate's voice
            sid = str(getattr(track, "sid", id(track)))
            if sid not in streams:
                streams[sid] = asyncio.get_running_loop().create_task(_pump(track))
        except Exception as exc:  # noqa: BLE001
            logger.info("loudness not started: %s", exc)

    @room.on("track_subscribed")
    def _subscribed(track: Any, publication: Any, participant: Any) -> None:
        _start(track, participant, publication)

    try:
        for participant in room.remote_participants.values():
            for publication in participant.track_publications.values():
                if getattr(publication, "track", None) is not None:
                    _start(publication.track, participant, publication)
    except Exception as exc:  # noqa: BLE001
        logger.info("loudness: existing tracks not read: %s", exc)
