"""Deepgram STT/Aura TTS bridges wiring the LiveKit worker's audio to the brain's transport.
Kept isolated so the transport + brain stay SDK-free. Verify the exact deepgram/rtc API against the
pinned livekit-plugins-deepgram 1.6.x when adding the dependency."""
from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable

from livekit import rtc
from livekit.agents.stt import SpeechEventType

from app.interview_agent.types import UtteranceTiming

logger = logging.getLogger(__name__)


async def publish_agent_audio(room, tts) -> tuple[object, Callable[[str], Awaitable[None]]]:
    """Publish an agent audio track and return (source, speak) where speak(text) synthesizes via Aura
    and pushes frames to the track."""
    sample_rate = getattr(tts, "sample_rate", 24000) or 24000
    num_channels = getattr(tts, "num_channels", 1) or 1
    source = rtc.AudioSource(sample_rate, num_channels)
    track = rtc.LocalAudioTrack.create_audio_track("interviewer-voice", source)
    options = rtc.TrackPublishOptions()
    options.source = rtc.TrackSource.SOURCE_MICROPHONE
    await room.local_participant.publish_track(track, options)

    async def speak(text: str) -> None:
        async for synthesized in tts.synthesize(text):
            await source.capture_frame(synthesized.frame)

    return source, speak


async def pump_stt(track, transport, stt) -> None:
    """Read the candidate audio track into Deepgram STT; on each FINAL transcript, push a turn to the
    transport (same pause-gated queue the typed `answer` path uses)."""
    stt_stream = stt.stream()

    async def feed() -> None:
        try:
            async for audio_event in rtc.AudioStream(track):
                stt_stream.push_frame(audio_event.frame)
        finally:
            stt_stream.end_input()

    async def consume() -> None:
        async for event in stt_stream:
            if event.type == SpeechEventType.FINAL_TRANSCRIPT and event.alternatives:
                alt = event.alternatives[0]
                text = (alt.text or "").strip()
                if not text:
                    continue
                ttfw = (alt.words[0].start_time - alt.start_time) if getattr(alt, "words", None) else 0.0
                transport.push_utterance(text, UtteranceTiming(alt.start_time, alt.end_time, ttfw))

    await asyncio.gather(feed(), consume())
