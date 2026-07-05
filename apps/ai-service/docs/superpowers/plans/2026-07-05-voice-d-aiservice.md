# Voice (Sub-project D) — ai-service Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the Deepgram STT + Aura TTS voice pipeline to the existing LiveKit worker, around the UNCHANGED brain. Candidate audio → Deepgram STT → `transport.push_utterance` → `run_session` → `transport.say` → Deepgram Aura TTS → published audio track. The data channel (captions/control/artifact/proctor) is untouched from A.

**Architecture:** The transport gains `push_utterance(text, timing)` (enqueue an STT turn onto the same queue `next_utterance` drains, with A's pause-gate) and an injected `speak` hook in `say()` (synthesize+publish Aura audio alongside the existing caption + speaking toggles). A new `app/interview_agent/voice.py` holds the SDK-facing bridges: `pump_stt(track, transport, stt)` (AudioStream→STT→push_utterance) and `publish_agent_audio(room, tts)` (AudioSource+track→a `speak(text)` closure). The worker connects `AUDIO_ONLY`, builds the Deepgram STT/TTS, injects `speak` into the transport, and starts the STT pump on `track_subscribed`. The brain (`session.py` etc.) and the transport's queue/pause/disconnect logic are UNCHANGED.

**Tech Stack:** Python 3.11, `livekit==1.1.12` (rtc), `livekit-agents==1.6.4`, `livekit-plugins-deepgram~=1.6` (NEW), pytest (sync + `asyncio.run` + `monkeypatch`).

## Global Constraints

- **The brain is FROZEN** (`session.py`, `graph.py`, `scoring.py`, `pacing.py`, `scope.py`, `state.py`, `llm_ops.py`, `types.py`, `prompts/`). D touches only `transport.py` (additively), `worker.py`, a new `voice.py`, `config.py`, `requirements.txt`, `tests/conftest.py`.
- **Preserve A's transport behavior exactly.** `push_utterance` MUST use the same pause gate as the `answer` branch: enqueue to `self._queue` via `put_nowait` when `self._not_paused.is_set()`, else append to `self._paused_buffer` (which is flushed on resume). `say()` MUST still emit the three data messages in order `speaking(true)` → `interviewer_utterance` → `speaking(false)` (the existing `test_say_emits_speaking_and_utterance` asserts `["speaking","interviewer_utterance","speaking"]`); the Aura audio is out-of-band (does not appear in the `sent` list).
- **Transport stays SDK-free + unit-testable.** The TTS is injected as a callable `speak: Callable[[str], Awaitable[None]] | None` — the transport never imports `livekit`/deepgram. Tests pass a fake `speak`.
- **Verified external APIs** (do not re-derive; confirm names against the pinned `livekit-plugins-deepgram==1.6.4` when installed):
  - rtc read: `rtc.AudioStream(track)` async-iterates `AudioFrameEvent` with `.frame: rtc.AudioFrame`.
  - rtc publish: `src = rtc.AudioSource(sample_rate, num_channels)`; `track = rtc.LocalAudioTrack.create_audio_track(name, src)`; `opts = rtc.TrackPublishOptions(); opts.source = rtc.TrackSource.SOURCE_MICROPHONE`; `await room.local_participant.publish_track(track, opts)`; `await src.capture_frame(frame)` (capture_frame + publish_track are **async**).
  - connect: `from livekit.agents import AutoSubscribe`; `await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)`; `ctx.room.on("track_subscribed")` handler `(track, publication, participant)`; gate `track.kind == rtc.TrackKind.KIND_AUDIO`.
  - Deepgram STT: `from livekit.plugins import deepgram`; `stt = deepgram.STT(model="nova-3", language="en", api_key=settings.deepgram_api_key)`; `s = stt.stream()`; `s.push_frame(frame)` (sync), `s.end_input()`; `async for ev in s:` yields `SpeechEvent` with `ev.type` (`SpeechEventType.FINAL_TRANSCRIPT` etc.) + `ev.alternatives: list[SpeechData]`; `SpeechData` has `.text`, `.start_time`, `.end_time`, `.words: list[TimedString]|None` (each with `.start_time`).
  - Deepgram Aura TTS: `tts = deepgram.TTS(model="aura-2-asteria-en", api_key=settings.deepgram_api_key)`; `async for a in tts.synthesize(text):` yields `SynthesizedAudio` with `.frame: rtc.AudioFrame`; `tts.sample_rate`/`tts.num_channels` size the `AudioSource`.
- **Module-level imports for monkeypatchability:** in `worker.py` and `voice.py`, `from livekit import rtc`, `from livekit.plugins import deepgram`, `from livekit.agents import AutoSubscribe` at module top so tests can `monkeypatch.setattr(<module>, "deepgram", Fake)` / `"rtc"` / etc.
- **Config:** `deepgram_api_key: str = Field(..., alias="DEEPGRAM_API_KEY")` (required); `tests/conftest.py` adds `os.environ.setdefault("DEEPGRAM_API_KEY", "test-dg-key")` (conftest ONLY — NOT `test_config._base_env`). Dep is a stop-and-ask item; the human approved Deepgram in brainstorming — proceed + document.
- **Tests:** sync `def test_*` + `asyncio.run`; fake the SDK collaborators (fake `deepgram.STT/TTS`, fake `rtc.AudioStream`/`AudioSource`); `monkeypatch` module attrs. Run `.venv/bin/python -m pytest tests/interview_agent -q` (83 today). The real audio loop is verified only by the manual smoke (needs `DEEPGRAM_API_KEY`) — documented, out of CI.

## File Structure

- `app/config.py` — **modify**: add `deepgram_api_key`.
- `tests/conftest.py` — **modify**: dummy `DEEPGRAM_API_KEY`.
- `requirements.txt` — **modify**: add `livekit-plugins-deepgram~=1.6`.
- `app/interview_agent/transport.py` — **modify**: add `push_utterance` + `speak` hook in `say()` + `speak` ctor param.
- `app/interview_agent/voice.py` — **create**: `pump_stt`, `publish_agent_audio`.
- `app/interview_agent/worker.py` — **modify**: `AUDIO_ONLY` connect + build STT/TTS + inject `speak` + `track_subscribed` pump.
- Tests alongside.

---

### Task 1: Config + dependency + conftest

**Files:** Modify `app/config.py`, `tests/conftest.py`, `requirements.txt`. Test: `tests/interview_agent/test_voice_config.py`.

**Interfaces:** Produces `Settings.deepgram_api_key` (required, alias `DEEPGRAM_API_KEY`).

- [ ] **Step 1: Failing test** — `tests/interview_agent/test_voice_config.py`:
```python
from app.config import get_settings

def test_deepgram_api_key_present():
    assert get_settings().deepgram_api_key   # conftest sets a dummy so this loads offline
```
- [ ] **Step 2: Run → FAIL** — `.venv/bin/python -m pytest tests/interview_agent/test_voice_config.py -q` (AttributeError/ValidationError).
- [ ] **Step 3:** In `app/config.py`, in the LiveKit block (~L192-195) add:
```python
    deepgram_api_key: str = Field(..., alias="DEEPGRAM_API_KEY")
```
- [ ] **Step 4:** In `tests/conftest.py`, after the `LIVEKIT_*` setdefaults, add:
```python
os.environ.setdefault("DEEPGRAM_API_KEY", "test-dg-key")
```
- [ ] **Step 5:** In `requirements.txt`, add (install ONLINE — verify latest 1.6.x matches `livekit-agents` 1.6.4):
```
livekit-plugins-deepgram~=1.6   # Pipeline 2 voice (sub-project D): Deepgram STT + Aura TTS
```
Run `.venv/bin/python -m pip install 'livekit-plugins-deepgram~=1.6'`.
- [ ] **Step 6: Run → PASS** — the new test + full slice `.venv/bin/python -m pytest tests/interview_agent -q` (84 now).
- [ ] **Step 7: Commit** — `git add app/config.py tests/conftest.py requirements.txt tests/interview_agent/test_voice_config.py && git commit -m "feat(voice): Deepgram config + livekit-plugins-deepgram dep + test env"`

---

### Task 2: Transport — `push_utterance` + `say` speak-hook

**Files:** Modify `app/interview_agent/transport.py`. Test: `tests/interview_agent/test_transport_voice.py`.

**Interfaces:**
- Consumes: `UtteranceTiming` (`types.py`).
- Produces: `LiveKitTransport(room, *, send, speak: Callable[[str], Awaitable[None]] | None = None)`; `push_utterance(text: str, timing: UtteranceTiming) -> None` (sync, pause-gated); `say()` calls `await self._speak(text)` (if set) between the caption and the closing `speaking:false`.

- [ ] **Step 1: Failing test** — `tests/interview_agent/test_transport_voice.py`:
```python
import asyncio
from app.interview_agent.transport import LiveKitTransport
from app.interview_agent.types import UtteranceTiming


class FakeRoom: ...


def _make(speak=None):
    sent = []
    async def send(p): sent.append(p)
    return LiveKitTransport(FakeRoom(), send=send, speak=speak), sent


def test_push_utterance_enqueues_and_next_utterance_returns_it():
    t, _ = _make()
    async def scenario():
        t.push_utterance("spoken answer", UtteranceTiming(1.0, 4.0, 0.5))
        return await t.next_utterance()
    text, timing = asyncio.run(scenario())
    assert text == "spoken answer"
    assert timing.time_to_first_word_s == 0.5


def test_push_utterance_withheld_while_paused_then_flushed_on_resume():
    t, _ = _make()
    async def scenario():
        await t.handle_incoming({"type": "proctor", "event": "fullscreen_exit"})   # pause
        t.push_utterance("during pause", UtteranceTiming(0.0, 1.0, 0.0))
        try:
            await asyncio.wait_for(t.next_utterance(), timeout=0.2)
            got_while_paused = True
        except asyncio.TimeoutError:
            got_while_paused = False
        await t.handle_incoming({"type": "proctor", "event": "fullscreen_restored"})  # resume flushes
        item = await asyncio.wait_for(t.next_utterance(), timeout=1.0)
        return got_while_paused, item
    withheld, item = asyncio.run(scenario())
    assert withheld is False
    assert item[0] == "during pause"


def test_say_invokes_speak_hook_and_still_emits_three_messages():
    spoken = []
    async def speak(text): spoken.append(text)
    t, sent = _make(speak=speak)
    asyncio.run(t.say("please introduce yourself"))
    assert [m["type"] for m in sent] == ["speaking", "interviewer_utterance", "speaking"]
    assert spoken == ["please introduce yourself"]


def test_say_without_speak_hook_still_works():
    t, sent = _make(speak=None)
    asyncio.run(t.say("no audio"))
    assert [m["type"] for m in sent] == ["speaking", "interviewer_utterance", "speaking"]
```
- [ ] **Step 2: Run → FAIL** (`speak` kwarg / `push_utterance` missing).
- [ ] **Step 3:** In `transport.py`: add `speak` param to `__init__` (`self._speak = speak`); add:
```python
    def push_utterance(self, text: str, timing: UtteranceTiming) -> None:
        item = (text, timing)
        if self._not_paused.is_set():
            self._queue.put_nowait(item)
        else:
            self._paused_buffer.append(item)
```
and modify `say` to call the hook between the caption and the closing toggle:
```python
    async def say(self, text: str) -> None:
        await self._send({"type": "speaking", "who": "interviewer", "speaking": True})
        await self._send({"type": "interviewer_utterance", "text": text})
        if self._speak is not None:
            try:
                await self._speak(text)
            except Exception as exc:  # noqa: BLE001 - voice is best-effort over the always-present caption
                logger.warning("TTS speak failed: %s", exc)
        await self._send({"type": "speaking", "who": "interviewer", "speaking": False})
```
- [ ] **Step 4: Run → PASS** (4 new); also run `test_livekit_transport.py` (existing pause/say tests must still pass).
- [ ] **Step 5: Commit** — `git add app/interview_agent/transport.py tests/interview_agent/test_transport_voice.py && git commit -m "feat(voice): transport push_utterance + injectable Aura speak hook in say()"`

---

### Task 3: Voice bridge (`app/interview_agent/voice.py`)

**Files:** Create `app/interview_agent/voice.py`. Test: `tests/interview_agent/test_voice.py`.

**Interfaces:**
- Produces: `async def publish_agent_audio(room, tts) -> tuple[object, Callable[[str], Awaitable[None]]]` (creates the AudioSource+track, returns `(source, speak)` where `speak(text)` synthesizes via `tts` and captures frames into `source`); `async def pump_stt(track, transport, stt) -> None` (AudioStream→STT→`transport.push_utterance` on final transcripts).
- Consumes: module-level `from livekit import rtc`; `UtteranceTiming`; `livekit.agents.stt.SpeechEventType` (import at module top for monkeypatch).

- [ ] **Step 1: Failing test** — `tests/interview_agent/test_voice.py` (fakes for rtc + STT/TTS):
```python
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
    class FakeSource:
        sample_rate = 24000; num_channels = 1
        async def capture_frame(self, frame): captured.append(frame)
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
    class FakeTransport:
        def push_utterance(self, text, timing): pushed.append((text, timing))

    asyncio.run(voice.pump_stt(object(), FakeTransport(), FakeSTT()))
    assert len(pushed) == 1
    text, timing = pushed[0]
    assert text == "my spoken answer"
    assert timing.t_start == 1.0 and timing.t_end == 4.0
    assert abs(timing.time_to_first_word_s - 0.2) < 1e-6   # word.start_time - alt.start_time
```
- [ ] **Step 2: Run → FAIL** (module missing).
- [ ] **Step 3: Implement** `app/interview_agent/voice.py`:
```python
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
```
- [ ] **Step 4: Run → PASS** (2 tests).
- [ ] **Step 5: Commit** — `git add app/interview_agent/voice.py tests/interview_agent/test_voice.py && git commit -m "feat(voice): STT pump + Aura TTS publish bridges"`

---

### Task 4: Worker wiring (audio connect + STT/TTS + inject speak + track pump)

**Files:** Modify `app/interview_agent/worker.py`. Test: extend `tests/interview_agent/test_worker.py`.

**Interfaces:**
- Consumes: `voice.publish_agent_audio`, `voice.pump_stt` (Task 3), `deepgram.STT/TTS` (module-level), `AutoSubscribe`, `LiveKitTransport(..., speak=...)` (Task 2).
- Produces: `run_interview` builds the Aura TTS + injects `speak` into the transport, and registers a `track_subscribed` handler starting `pump_stt` for the candidate audio; `entrypoint` connects `AUDIO_ONLY`.

- [ ] **Step 1: Failing test** — extend `tests/interview_agent/test_worker.py`: assert `run_interview` (a) constructs the transport WITH a `speak` hook (i.e. TTS published), and (b) registers a `track_subscribed` handler that, when fired with a fake audio track, starts `pump_stt`. Use the existing `FakeRoom`/`FakeCtx` pattern extended with `on("track_subscribed")` capture; monkeypatch `worker.deepgram` (fake STT/TTS), `worker.voice.publish_agent_audio` (returns `(fake_source, fake_speak)`), `worker.voice.pump_stt` (records the call), `worker.repo.get_plan`, `worker.run_session` (assert the transport it receives has a non-None `_speak`), `worker.post_outcome`. Assert: `publish_agent_audio` called; the transport passed to `run_session` has `_speak is not None`; firing the captured `track_subscribed` handler with an audio track schedules `pump_stt(track, transport, stt)`. Write the test mirroring the existing worker-test fakes.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** in `worker.py`:
  - Module top: `from livekit import rtc`, `from livekit.agents import AutoSubscribe`, `from livekit.plugins import deepgram`, `from app.interview_agent import voice`.
  - `entrypoint`: change `await ctx.connect()` → `await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)`.
  - `run_interview`, after building `send` and BEFORE constructing the transport, build TTS + speak, then construct the transport with the hook, then wire STT pump:
    ```python
    tts = deepgram.TTS(model="aura-2-asteria-en", api_key=settings.deepgram_api_key)
    _source, speak = await voice.publish_agent_audio(ctx.room, tts)
    transport = LiveKitTransport(ctx.room, send=send, speak=speak)
    _wire_data_received(ctx.room, transport)

    stt = deepgram.STT(model="nova-3", language="en", api_key=settings.deepgram_api_key)
    _pump_tasks: set = set()
    on = getattr(ctx.room, "on", None)
    if on is not None:
        @on("track_subscribed")
        def _on_track(track, *_args, **_kwargs):
            if getattr(track, "kind", None) == rtc.TrackKind.KIND_AUDIO:
                task = asyncio.create_task(voice.pump_stt(track, transport, stt))
                _pump_tasks.add(task)
                task.add_done_callback(_pump_tasks.discard)
    ```
    (Keep the rest of `run_interview` — `run_session`, outcome post, `ended` — unchanged. The `LiveKitTransport` construction moves from its current spot to after `speak` is built; ensure `_wire_data_received` still runs on the same transport instance.)
  - NOTE: `deepgram.STT`/`TTS` construction hits the network lazily; in tests they're monkeypatched. The `track_subscribed` registration + `pump_stt` task are glue — the test drives the captured handler directly.
- [ ] **Step 4: Run → PASS**; then full slice `.venv/bin/python -m pytest tests/interview_agent -q` (should be ~88).
- [ ] **Step 5: Commit** — `git add app/interview_agent/worker.py tests/interview_agent/test_worker.py && git commit -m "feat(voice): worker wires Deepgram STT pump + Aura TTS speak into the live session"`

---

## Self-Review

**Spec coverage (D design §4.1):** STT→push_utterance → Task 3+4 ✅; Aura TTS in say → Task 2 (hook) + 3 (speak) + 4 (inject) ✅; AUDIO_ONLY connect + track_subscribed → Task 4 ✅; config/dep → Task 1 ✅; data-channel unchanged (say still emits caption+speaking; push_utterance uses the same pause gate) ✅.
**Frozen-brain check:** no task edits `session.py`/etc. `run_session` still receives a `LiveKitTransport` implementing the same `Transport` protocol (say/next_utterance/current_artifact/end_session) — `push_utterance`/`speak` are additive.
**Type consistency:** `push_utterance(text, timing)` + `speak: Callable[[str],Awaitable[None]]` consistent across Tasks 2/3/4; `UtteranceTiming(t_start,t_end,time_to_first_word_s)` matches `types.py`.
**Placeholder scan:** deepgram model ids (`nova-3`, `aura-2-asteria-en`) + plugin ctor kwargs carry a "verify against pinned 1.6.4" note (external); all our-side logic is complete.
**Known risks:** (1) the exact `deepgram.STT/TTS` ctor kwargs (`endpointing_ms`, `interim_results`, model ids) must be confirmed against the installed 1.6.4 plugin at Task 1/4 — adjust ctor calls only, not the pump/transport logic. (2) The audio loop is only truly verified by the manual smoke (needs `DEEPGRAM_API_KEY`); CI covers the bridges with fakes. (3) `AudioSource` sample rate must match the TTS frame rate — `publish_agent_audio` reads `tts.sample_rate`.
