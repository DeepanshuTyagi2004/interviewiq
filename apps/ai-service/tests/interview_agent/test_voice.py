import asyncio
import types as _types

from app.interview_agent import voice
from app.interview_agent.types import UtteranceTiming


class _AsyncIter:
    def __init__(self, items): self._items = list(items)
    def __aiter__(self): return self
    async def __anext__(self):
        if not self._items: raise StopAsyncIteration
        return self._items.pop(0)


def test_publish_agent_audio_returns_speak_that_captures_tts_frames(monkeypatch):
    captured = []
    playout_waits = []
    class FakeSource:
        sample_rate = 24000; num_channels = 1
        async def capture_frame(self, frame): captured.append(frame)
        async def wait_for_playout(self): playout_waits.append(True)
    class FakeTrack: ...
    class FakeLocal:
        async def publish_track(self, track, opts): return "pub"
    class FakeRoom:
        local_participant = FakeLocal()
    # patch rtc primitives used by publish_agent_audio
    fake_rtc = _types.SimpleNamespace(
        AudioSource=lambda sample_rate, num_channels: FakeSource(),
        LocalAudioTrack=_types.SimpleNamespace(create_audio_track=lambda name, src: FakeTrack()),
        TrackPublishOptions=lambda: _types.SimpleNamespace(source=None),
        TrackSource=_types.SimpleNamespace(SOURCE_MICROPHONE="mic"),
    )
    monkeypatch.setattr(voice, "rtc", fake_rtc)

    class FakeTTS:
        sample_rate = 24000; num_channels = 1
        def synthesize(self, text):
            return _AsyncIter([_types.SimpleNamespace(frame=f"frame:{text}:1"),
                               _types.SimpleNamespace(frame=f"frame:{text}:2")])

    async def scenario():
        source, speak = await voice.publish_agent_audio(FakeRoom(), FakeTTS())
        await speak("hello")
        return captured
    result = asyncio.run(scenario())
    assert result == ["frame:hello:1", "frame:hello:2"]
    # speak() must wait for real playout before returning, so speaking:false only fires
    # once the candidate has actually stopped hearing the AI.
    assert playout_waits == [True]


def test_pump_stt_pushes_final_transcripts_as_utterances(monkeypatch):
    # fake STT stream: push_frame records; iterating yields one FINAL_TRANSCRIPT event
    from livekit.agents.stt import SpeechEventType
    word = _types.SimpleNamespace(start_time=1.2)
    alt = _types.SimpleNamespace(text="my spoken answer", start_time=1.0, end_time=4.0, words=[word])
    final = _types.SimpleNamespace(type=SpeechEventType.FINAL_TRANSCRIPT, alternatives=[alt])

    class FakeSTTStream:
        def __init__(self): self.frames = []
        def push_frame(self, f): self.frames.append(f)
        def end_input(self): pass
        def __aiter__(self): return _AsyncIter([final]).__aiter__()
    class FakeSTT:
        def stream(self): return FakeSTTStream()

    # fake rtc.AudioStream over the track yields 2 frame events then ends
    fake_rtc = _types.SimpleNamespace(
        AudioStream=lambda track: _AsyncIter([_types.SimpleNamespace(frame="f1"), _types.SimpleNamespace(frame="f2")]),
    )
    monkeypatch.setattr(voice, "rtc", fake_rtc)

    pushed = []
    echoed = []
    class FakeTransport:
        def push_utterance(self, text, timing): pushed.append((text, timing))
        async def send_candidate_utterance(self, text): echoed.append(text)

    asyncio.run(voice.pump_stt(object(), FakeTransport(), FakeSTT()))
    assert len(pushed) == 1
    text, timing = pushed[0]
    assert text == "my spoken answer"
    assert timing.t_start == 1.0 and timing.t_end == 4.0
    assert abs(timing.time_to_first_word_s - 0.2) < 1e-6   # word.start_time - alt.start_time
    assert echoed == ["my spoken answer"]


def test_pump_stt_survives_a_bad_transcript(monkeypatch):
    # first alternative raises the moment its `.text` is touched (simulates a malformed/partial
    # transcript from the SDK); the second event is a normal, valid final transcript.
    from livekit.agents.stt import SpeechEventType

    class _BoomAlt:
        @property
        def text(self):
            raise RuntimeError("boom: malformed alternative")

    bad_final = _types.SimpleNamespace(type=SpeechEventType.FINAL_TRANSCRIPT, alternatives=[_BoomAlt()])

    word = _types.SimpleNamespace(start_time=2.5)
    good_alt = _types.SimpleNamespace(text="the second one works", start_time=2.0, end_time=3.0, words=[word])
    good_final = _types.SimpleNamespace(type=SpeechEventType.FINAL_TRANSCRIPT, alternatives=[good_alt])

    class FakeSTTStream:
        def __init__(self): self.frames = []
        def push_frame(self, f): self.frames.append(f)
        def end_input(self): pass
        def __aiter__(self): return _AsyncIter([bad_final, good_final]).__aiter__()
    class FakeSTT:
        def stream(self): return FakeSTTStream()

    fake_rtc = _types.SimpleNamespace(
        AudioStream=lambda track: _AsyncIter([]),
    )
    monkeypatch.setattr(voice, "rtc", fake_rtc)

    pushed = []
    class FakeTransport:
        def push_utterance(self, text, timing): pushed.append((text, timing))
        async def send_candidate_utterance(self, text): pass

    # must complete without raising despite the first (bad) transcript
    asyncio.run(voice.pump_stt(object(), FakeTransport(), FakeSTT()))

    assert len(pushed) == 1
    text, timing = pushed[0]
    assert text == "the second one works"
    assert abs(timing.time_to_first_word_s - 0.5) < 1e-6


def test_ttfw_zero_when_word_timing_missing(monkeypatch):
    # alt.words is None (no word-level timing available) -> ttfw must default to 0.0, not raise.
    from livekit.agents.stt import SpeechEventType

    alt = _types.SimpleNamespace(text="no word timing here", start_time=1.0, end_time=2.0, words=None)
    final = _types.SimpleNamespace(type=SpeechEventType.FINAL_TRANSCRIPT, alternatives=[alt])

    class FakeSTTStream:
        def __init__(self): self.frames = []
        def push_frame(self, f): self.frames.append(f)
        def end_input(self): pass
        def __aiter__(self): return _AsyncIter([final]).__aiter__()
    class FakeSTT:
        def stream(self): return FakeSTTStream()

    fake_rtc = _types.SimpleNamespace(
        AudioStream=lambda track: _AsyncIter([]),
    )
    monkeypatch.setattr(voice, "rtc", fake_rtc)

    pushed = []
    class FakeTransport:
        def push_utterance(self, text, timing): pushed.append((text, timing))
        async def send_candidate_utterance(self, text): pass

    asyncio.run(voice.pump_stt(object(), FakeTransport(), FakeSTT()))

    assert len(pushed) == 1
    text, timing = pushed[0]
    assert text == "no word timing here"
    assert timing.time_to_first_word_s == 0.0


# ---- Task 5: select_voice (persona.gender -> Aura-2 voice, name-inference fallback) ----

def test_select_voice_male_gender():
    assert asyncio.run(voice.select_voice({"gender": "male"})) == "aura-2-apollo-en"


def test_select_voice_female_gender_is_case_insensitive():
    assert asyncio.run(voice.select_voice({"gender": "Female"})) == "aura-2-asteria-en"


def test_select_voice_neutral_gender():
    assert asyncio.run(voice.select_voice({"gender": "neutral"})) == "aura-2-asteria-en"


def test_select_voice_infers_from_name_when_gender_missing():
    async def infer(name):
        assert name == "Priya"
        return "female"
    result = asyncio.run(voice.select_voice({"name": "Priya"}, infer=infer))
    assert result == "aura-2-asteria-en"


def test_select_voice_defaults_when_no_gender_and_no_infer():
    assert asyncio.run(voice.select_voice({}, infer=None)) == voice.DEFAULT_VOICE


def test_select_voice_defaults_when_infer_returns_none():
    async def infer(name):
        return None
    result = asyncio.run(voice.select_voice({"name": "X"}, infer=infer))
    assert result == voice.DEFAULT_VOICE
