# Voice (Sub-project D) — Frontend Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Wire real audio I/O into `LiveKitLiveSession` so the candidate's mic reaches the worker's STT and the AI's Aura TTS audio plays in the browser — completing the spoken loop. This is the final slice of sub-project A+D.

**Architecture:** `LiveKitLiveSession.connect` already connects a `livekit-client` `Room` and bridges the data channel. D adds three things: (1) publish the candidate mic to the room (`localParticipant.setMicrophoneEnabled(true)`) so the ai-service worker's Deepgram STT hears it; (2) subscribe + attach the AI's audio track (`RoomEvent.TrackSubscribed` → `track.attach()` → play) so the candidate hears Aura TTS; (3) best-effort `room.startAudio()` (the connect path runs inside the user's "Enter" click gesture) to satisfy browser autoplay. `setMicEnabled` now also toggles the room mic. Everything else (data channel, connection bridge, self-view) is unchanged.

**Tech Stack:** `livekit-client ^2.20`, TypeScript, vitest (mocked `Room`).

## Global Constraints

- Modify ONLY `features/interview-live/session/LiveKitLiveSession.ts` (+ its test). Do NOT change the `LiveSession` interface, the machine, the provider, or the route.
- Preserve all existing A behavior: the `DataReceived`→`onControl` bridge, `ConnectionStateChanged`→`onConnectionChange`, the connect() failure-reset + the "only force 'connected' if still 'connecting'" guard, `sendArtifact`/`sendProctorEvent`, `getLocalStream` (local self-view), and the existing tests must all stay green.
- **Register the `TrackSubscribed` handler BEFORE `await room.connect(...)`** (same as the existing `DataReceived`/`ConnectionStateChanged` handlers) so no early track is missed.
- **`startAudio()` is best-effort:** wrap in try/catch — if the browser blocks autoplay it must not fail `connect()` (the candidate can still read captions; audio resumes on a later gesture). Same for `setMicrophoneEnabled` — a mic-publish failure must not abort connect (log/swallow; the interview can proceed, degraded).
- **Attached audio elements must be cleaned up on `disconnect()`** (detach + remove from DOM) so a re-join or unmount doesn't leak `<audio>` nodes.
- `livekit-client` API (verified v2.20): `import { Track } from 'livekit-client'`; `RoomEvent.TrackSubscribed` handler `(track: RemoteTrack, publication, participant)`; gate `track.kind === Track.Kind.Audio`; `track.attach(): HTMLMediaElement` (creates + starts an element) / `track.detach()`; `room.localParticipant.setMicrophoneEnabled(on: boolean): Promise<...>`; `room.startAudio(): Promise<void>`.
- Tests: `vi.mock('livekit-client')` mock `Room` (extend the existing test's mock) — assert mic publish + audio attach + startAudio via the mock. Commands: `npx vitest run features/interview-live/session/LiveKitLiveSession.test.ts`, `npx vitest run features/interview-live`, `npx tsc --noEmit`, `npx eslint features/interview-live/session/LiveKitLiveSession.ts`.

## File Structure
- `features/interview-live/session/LiveKitLiveSession.ts` — **modify**: audio I/O.
- `features/interview-live/session/LiveKitLiveSession.test.ts` — **modify**: audio tests.

---

### Task 1: Real audio I/O in `LiveKitLiveSession`

**Files:** Modify `features/interview-live/session/LiveKitLiveSession.ts` + `.test.ts`.

**Interfaces:** No signature changes — the `LiveSession` shape is unchanged. Internally adds `audioEls: HTMLMediaElement[]` and audio wiring in `connect`/`disconnect`/`setMicEnabled`.

- [ ] **Step 1: Write the failing tests** — extend `LiveKitLiveSession.test.ts`. The existing mock (`vi.mock('livekit-client')`) has a fake `Room` with `localParticipant.publishData` + an `on(event, cb)` capturing handlers in `handlers` + `connect`/`disconnect`. Extend the mock: add `setMicrophoneEnabled: vi.fn(async()=>{})` + `startAudio: vi.fn(async()=>{})` to the fake room; export `Track: { Kind: { Audio: 'audio', Video: 'video' } }` from the mock; add `RoomEvent.TrackSubscribed: 'trackSubscribed'`. Then add:
```ts
it("publishes the candidate mic on connect", async () => {
  const s = new LiveKitLiveSession();
  await s.connect("s1");
  expect(setMicrophoneEnabled).toHaveBeenCalledWith(true);
});

it("attaches and plays a subscribed AI audio track", async () => {
  const s = new LiveKitLiveSession();
  await s.connect("s1");
  const attach = vi.fn(() => document.createElement("audio"));
  const fakeTrack = { kind: "audio", attach, detach: vi.fn() };
  handlers["trackSubscribed"](fakeTrack);
  expect(attach).toHaveBeenCalled();
});

it("ignores subscribed non-audio tracks", async () => {
  const s = new LiveKitLiveSession();
  await s.connect("s1");
  const attach = vi.fn(() => document.createElement("video"));
  handlers["trackSubscribed"]({ kind: "video", attach, detach: vi.fn() });
  expect(attach).not.toHaveBeenCalled();
});

it("calls startAudio (best-effort) on connect", async () => {
  const s = new LiveKitLiveSession();
  await s.connect("s1");
  expect(startAudio).toHaveBeenCalled();
});

it("connect still succeeds if startAudio/mic publish reject", async () => {
  setMicrophoneEnabled.mockRejectedValueOnce(new Error("no mic"));
  startAudio.mockRejectedValueOnce(new Error("autoplay blocked"));
  const s = new LiveKitLiveSession();
  await expect(s.connect("s1")).resolves.toBeUndefined();
  expect(s.connectionState).toBe("connected");
});

it("detaches attached audio on disconnect", async () => {
  const s = new LiveKitLiveSession();
  await s.connect("s1");
  const detach = vi.fn();
  const el = document.createElement("audio");
  handlers["trackSubscribed"]({ kind: "audio", attach: () => el, detach });
  await s.disconnect();
  expect(detach).toHaveBeenCalled();
});
```
(Adapt names to the existing mock's structure — reuse its `handlers` object + module-level `vi.fn`s. If the existing mock declares the fake room inline, add `setMicrophoneEnabled`/`startAudio` to `localParticipant`/room and expose them as module-level `vi.fn`s the tests can assert on.)

- [ ] **Step 2: Run → FAIL** — `npx vitest run features/interview-live/session/LiveKitLiveSession.test.ts`.

- [ ] **Step 3: Implement** in `LiveKitLiveSession.ts`:
  - Import `Track`: `import { ConnectionState, Room, RoomEvent, Track } from 'livekit-client'` and the type `import type { RemoteTrack } from 'livekit-client'` (or use `Track` type).
  - Add field `private audioEls: HTMLMediaElement[] = []`.
  - In `connect`, register the track handler alongside the existing `DataReceived`/`ConnectionStateChanged` handlers (BEFORE `await room.connect`):
    ```ts
    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Audio) {
        const el = track.attach()          // creates + plays an <audio> element
        this.audioEls.push(el)
      }
    })
    ```
  - After `await room.connect(livekitUrl, token)` (still inside the first try, or right after it), publish the mic + best-effort start audio — each guarded so it can't fail connect:
    ```ts
    try { await room.localParticipant.setMicrophoneEnabled(true) } catch { /* mic publish best-effort */ }
    try { await room.startAudio() } catch { /* autoplay may be blocked; captions still work */ }
    ```
    (Place these AFTER the room is connected. They must NOT be inside the catch that resets to 'disconnected' — a mic/autoplay failure is non-fatal, unlike a room.connect failure. Put them after the `await room.connect(...)` line but keep `room.connect`'s own failure in the reset-on-error try.)
  - `setMicEnabled(on)`: also toggle the room mic — `void this.room?.localParticipant.setMicrophoneEnabled(on)` — in addition to the existing self-view toggle:
    ```ts
    setMicEnabled(on: boolean) {
      this.stream?.getAudioTracks().forEach((t) => (t.enabled = on))
      void this.room?.localParticipant.setMicrophoneEnabled(on)
    }
    ```
  - `disconnect()`: detach + remove the attached audio els before disconnecting the room:
    ```ts
    this.audioEls.forEach((el) => { el.remove() })
    this.audioEls = []
    ```
    (If the track exposes `detach`, the element removal + the room disconnect release it; calling `el.remove()` unmounts the DOM node. The test asserts `detach` — if you prefer, keep references to the tracks and call `track.detach()`; simplest is to store the els and remove them, and rely on room.disconnect to stop the tracks. To satisfy the `detach`-called test, store the tracks too and call `track.detach()` on disconnect. Choose one and make the test match: store `{track}` and call `track.detach()` on disconnect, then `el.remove()`.)
  - NOTE on structure: keep `room.startAudio()`/`setMicrophoneEnabled(true)` on the connected room; ensure the trailing "force 'connected' if still 'connecting'" guard still runs after the (best-effort) audio setup + the getUserMedia self-view block.

- [ ] **Step 4: Run → PASS** — the new tests + the existing `LiveKitLiveSession.test.ts` tests (connect flow, data bridge, connection mapping, connect-fail reset) must all pass. Then `npx vitest run features/interview-live` (no regression), `npx tsc --noEmit` clean, `npx eslint features/interview-live/session/LiveKitLiveSession.ts` clean.

- [ ] **Step 5: Commit**
```bash
git add features/interview-live/session/LiveKitLiveSession.ts features/interview-live/session/LiveKitLiveSession.test.ts
git commit -m "feat(voice): publish candidate mic + play AI audio track in LiveKitLiveSession"
```

---

## Self-Review

**Spec coverage (D design §4.2):** publish mic on connect → ✅; subscribe + play AI audio → ✅; `startAudio()` best-effort on the enter gesture → ✅; speaking glow stays on the `speaking` control signal (unchanged) → ✅ (no change needed).
**A behavior preserved:** data bridge, connection mapping, connect-fail reset, self-view, artifact/proctor publish — all untouched; audio wiring is additive; best-effort guards ensure mic/autoplay failures don't break connect.
**Deferred (documented):** an explicit "click to enable audio" affordance when `startAudio` is blocked (`AudioPlaybackStatusChanged`) — MVP relies on the enter-gesture `startAudio`; add the affordance post-MVP if autoplay blocking is observed. Barge-in/interruption is out of scope (D spec §7).
**Known risks:** (1) `track.attach()`/`detach()` + element cleanup — the test asserts `detach` is called on disconnect, so store the track and call `track.detach()` (Step 3 disconnect note). (2) The real audio loop (candidate speaks → hears AI) is verified only by the manual smoke with a live `DEEPGRAM_API_KEY` + LiveKit keys — CI covers the wiring with the mocked `Room`.
