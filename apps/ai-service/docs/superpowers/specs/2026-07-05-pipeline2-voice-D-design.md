# Pipeline 2 — Voice (Sub-project D) Design

**Date:** 2026-07-05
**Status:** Design — awaiting review
**Depends on:** Sub-project A (live runtime), complete + merged in all three repos — the LiveKit worker + real `LiveKitTransport` (ai-service), the go-live token + outcome endpoints (backend), and the real `LiveKitLiveSession` + live route (frontend). D fills the audio I/O that A deliberately left open.
**Completes:** After D, a candidate joins a real room and has a **real spoken interview** — the only remaining sub-project is E (post-interview analysis).

## 1. Goal

Make the interview voice-driven, nothing mocked: the candidate speaks → **Deepgram STT** → the existing brain (unchanged) decides + writes a line → **Deepgram Aura TTS** → the candidate hears the AI. Today (A) the AI "speaks" via `interviewer_utterance` text captions over the data channel and the candidate can't answer (no audio path). D closes the loop with real audio, while keeping the data channel for captions, artifacts, proctor events, and control signals.

## 2. Locked decisions

- **Voice stack:** Deepgram STT + Deepgram **Aura** TTS (single vendor, chosen in brainstorming). The LangGraph brain stays the decision-maker — Deepgram is only ears + mouth.
- **The brain owns turn logic.** We do NOT hand control to LiveKit's high-level `AgentSession`/`VoicePipelineAgent` (which would run its own LLM loop). We drive Deepgram STT + Aura TTS as plugins wired into the existing `LiveKitTransport`, so `run_session` is unchanged.
- **Turn/endpoint detection:** use Deepgram streaming endpointing (utterance-end) — optionally augmented by Silero VAD — to decide when a candidate turn is complete, then push one `(text, UtteranceTiming)` to the transport. `time_to_first_word_s` comes from STT word timestamps (finally real, vs `0.0` in A's typed path).
- **Data channel stays.** Captions (`interviewer_utterance`), `speaking`, `pause`/`resume`/`acknowledge_violation`/`ended`, artifacts, and proctor events keep flowing over the data channel exactly as in A. D adds AUDIO alongside; it does not replace the control plane.
- **Config:** `DEEPGRAM_API_KEY` (ai-service, required to run live — user-provisioned). Dep: `livekit-plugins-deepgram`. `INTERVIEW_LLM_MODEL=gemini-flash` (already set) keeps conversational turns fast.

## 3. Architecture

```
Candidate browser (livekit-client)
  mic audio ─────────────▶┐                          ┌────▶ interviewer audio (Aura TTS) ─▶ <audio> playback
                          ▼                          │
              LiveKit room (SFU) ◀── data channel ──▶ (captions / control / artifact / proctor — unchanged from A)
                          ▲                          │
  AI worker (ai-service, LiveKit Agents):            │
    candidate AudioStream ─▶ Deepgram STT ─▶ (text, timing) ─▶ transport.push_utterance()
                                                     │             │
                          LiveKitTransport.next_utterance() ◀──────┘
                                     │
                          run_session (brain — UNCHANGED)
                                     │
                          transport.say(text) ─▶ Deepgram Aura TTS ─▶ publish AudioSource frames ─▶ room
                                     └─────────▶ (still emits the interviewer_utterance caption + speaking on/off)
```

## 4. Components

### 4.1 ai-service (the voice pipeline) — the bulk of D

- **`LiveKitTransport` additions** (`app/interview_agent/transport.py`):
  - `push_utterance(text: str, timing: UtteranceTiming) -> None` — enqueue a candidate turn from STT onto the SAME queue `next_utterance` drains (the pause-withhold + disconnect logic from A applies unchanged). The A-phase `answer` data-channel path stays as an accessibility/fallback input.
  - `say(text)` gains a TTS hook: in addition to the existing `interviewer_utterance` caption + `speaking` on/off data messages, synthesize `text` via Aura and publish audio frames. Keep the caption (accessibility + resilience if audio fails). `say` must set `speaking:true` before audio starts and `speaking:false` when playback finishes.
- **Voice wiring in the worker** (`app/interview_agent/worker.py` or a new `app/interview_agent/voice.py` bridge):
  - `ctx.connect(auto_subscribe=AUDIO_ONLY)` so the worker receives the candidate's mic track.
  - On the candidate audio track: pipe `rtc.AudioStream` frames → Deepgram STT streaming client; on an utterance-end/final transcript, call `transport.push_utterance(text, timing)`.
  - Provide the transport an Aura TTS sink: `say()` → Aura synthesize → `rtc.AudioSource` → a published `LocalAudioTrack`.
  - Keep the bridge thin + isolated (like the data-channel wiring); the brain + the transport's queue/pause logic are untouched.
- **Config:** add `deepgram_api_key: str = Field(..., alias="DEEPGRAM_API_KEY")`; dep `livekit-plugins-deepgram`; conftest dummy env.

### 4.2 frontend (audio I/O) — moderate

- **`LiveKitLiveSession`** (`features/interview-live/session/LiveKitLiveSession.ts`):
  - In `connect`, publish the candidate mic: `await room.localParticipant.setMicrophoneEnabled(true)` (the room now has an STT consumer).
  - Subscribe + play the AI audio: on `RoomEvent.TrackSubscribed` for an audio track, `track.attach()` into a hidden `<audio>` and play; on autoplay block, call `room.startAudio()` — trigger it from the user's "Enter" gesture in `ChecksView.handleEnter` (a real user gesture).
  - `getLocalStream()` continues returning the local self-view; the published mic is managed by the room.
- The **speaking glow** continues to be driven by the `speaking` control signal (already wired) — no change needed; optionally also react to the AI audio element.
- No new UI: the interview is now spoken; captions remain (accessibility).

## 5. Testing

- **ai-service:** unit-test the STT→`push_utterance` bridge and the `say`→TTS-publish path with a **fake Deepgram client** + a fake audio source/track (mock `livekit-plugins-deepgram` + the rtc audio primitives) — assert: a final transcript enqueues a `(text, timing)` that `next_utterance` returns; `say` publishes audio + emits the caption + `speaking` on/off. The brain stays covered by the existing `ScriptedTransport` suite (unchanged). Pattern: sync tests + `asyncio.run` + `monkeypatch`, like the A worker/transport tests.
- **frontend:** extend `LiveKitLiveSession.test.ts` (mocked `livekit-client` `Room`): assert `connect` calls `setMicrophoneEnabled(true)`; a `TrackSubscribed` audio event attaches + plays; `room.startAudio()` invoked on the enter path. Existing tests stay green.
- **Out of CI (manual smoke, documented):** one real interview against LiveKit Cloud + Deepgram — candidate speaks, AI responds in Aura voice, scoring/pacing/proctoring all work. Requires `DEEPGRAM_API_KEY` + LiveKit + LLM keys (user-provisioned).

## 6. Error handling

- STT stream error / no final transcript → the candidate turn simply doesn't arrive; `next_utterance`'s existing silence timeout (45s) + the brain's silence retries handle it, degrading to `ABORTED_TECHNICAL` if persistent (A behavior, unchanged).
- TTS (Aura) failure → log + still emit the `interviewer_utterance` caption (the candidate reads the line); the interview continues. Voice is best-effort over the always-present caption.
- Deepgram key missing/invalid at worker start → fail fast (required config), same as the other required keys.

## 7. Out of scope (this spec)

- **E — post-interview analysis** (reads A's persisted `SessionOutcome`).
- Barge-in / interruption handling (candidate talking over the AI), speaker diarization, prosodic/audio behavioral scoring (behavioral signals stay transcript + timing only, per the brain spec §2), multi-language, and voice-activity-based UI beyond the existing speaking glow. Revisit post-MVP.
- Recording/egress, video to the room.

## 8. Definition of done (D)

With `DEEPGRAM_API_KEY` + LiveKit + LLM keys configured, a real candidate joins a `PREP_READY` session, **speaks** to the AI (STT → brain), **hears** the AI's spoken questions/feedback (Aura TTS), writes code/draws (artifacts already flow), is scored/paced/steered live, proctoring pauses server-side on violations, and the interview ends with a persisted `SessionOutcome`. No mock at any layer. CI green (Deepgram/audio mocked); the manual smoke checklist passes. The only thing after this is E.
