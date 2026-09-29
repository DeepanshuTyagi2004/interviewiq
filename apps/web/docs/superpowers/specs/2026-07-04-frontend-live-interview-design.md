# Frontend Live-Interview Experience — Design

**Date:** 2026-07-04
**Status:** Design — pending user review
**Repo:** `interviewIQ-frontend` (Next.js 16 App Router, React 19, TanStack Query v5, Zod, vitest)
**Consumes:** Pipeline-1 booking/prep (built) and — via a mockable seam — Pipeline-2's live brain + transport (backend sub-projects A/D, not yet built).

---

## 1. Purpose & scope

The candidate journey from picking a company+role to sitting through a proctored, voice-driven mock
interview: **Start → prep → Join → prejoin/system-checks → live interview (Meet-like, code + diagram) →
report**. Built **now** against a **mockable `LiveSession` seam** so the entire UI + proctoring works
end-to-end today; the real LiveKit/voice connection swaps in later (backend A/D) with zero UI rework.

**In scope (5 phases):** FE-1 Start & readiness · FE-2 Prejoin & system checks · FE-3 Live shell
(Meet-like: code editor / Excalidraw, camera + AI avatar, controls) · FE-4 Proctoring & integrity ·
FE-5 Report placeholder.

**Out of scope (dependencies, flagged):** real LiveKit transport + STT/LLM/TTS voice (sub-projects A/D) —
we design against the seam and ship a `MockLiveSession`; the authoritative scorecard (sub-project E) —
FE-5 is a placeholder; the AI's *spoken* reaction to a violation — the control contract carries it, but
the voice reaction needs A + a brain violation-hook.

## 2. Locked decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Build sequencing | Frontend **now** against a mockable `LiveSession` seam |
| Integrity model | **Client deterrence + server-side enforcement** (client can't progress the interview by tampering) |
| Trigger flow | **Both** — on-demand "Start now" AND scheduled slots |
| Report | **Placeholder** page now; real scorecard when sub-project E lands |
| Editors | **Monaco** (code) + **Excalidraw** (diagram), both open-source, in-browser |
| Live-session state | A small **state machine** inside a `LiveSessionProvider` context |

## 3. The `LiveSession` seam (architectural spine)

One TypeScript interface abstracts the live connection. The UI depends only on this — never on LiveKit
directly. Two implementations: `MockLiveSession` (dev/tests, no backend) and `LiveKitLiveSession` (stub
now; real when A/D land).

```ts
type Speaker = 'candidate' | 'interviewer'
type ConnState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

interface ProctorEvent {
  type: 'fullscreen_exit' | 'fullscreen_restored' | 'tab_hidden' | 'tab_visible'
      | 'external_display_detected' | 'overlay_tamper'
  at: number
}
interface ArtifactSnapshot { kind: 'code' | 'diagram'; content: string; language?: string }

type ControlSignal =
  | { type: 'interviewer_utterance'; text: string }   // what the AI "says" (drives transcript/TTS later)
  | { type: 'speaking'; who: Speaker; speaking: boolean }
  | { type: 'pause'; reason: string }                 // server gate: candidate must not proceed
  | { type: 'resume' }
  | { type: 'acknowledge_violation'; text?: string }  // AI notes a violation (voice reaction deferred)
  | { type: 'ended'; reason: string }

interface LiveSession {
  connect(sessionId: string): Promise<void>
  disconnect(): Promise<void>
  readonly connectionState: ConnState

  // local media (getUserMedia handles live behind the seam so Mock and real share the UI)
  getLocalStream(): MediaStream | null
  setMicEnabled(on: boolean): void
  setCameraEnabled(on: boolean): void

  // candidate → agent
  sendArtifact(a: ArtifactSnapshot): void         // debounced snapshot of code/diagram
  sendProctorEvent(e: ProctorEvent): void

  // agent/server → candidate
  onControl(cb: (c: ControlSignal) => void): () => void   // returns unsubscribe
  onConnectionChange(cb: (s: ConnState) => void): () => void
}
```

**`MockLiveSession` behavior (dev + tests):** acquires real local media via `getUserMedia`; on `connect`
emits a scripted sequence of `interviewer_utterance` + `speaking` pulses (so the AI-bubble glow + a
transcript work); on receiving a `fullscreen_exit`/`tab_hidden` proctor event it echoes a `pause` (and a
canned `acknowledge_violation`), and on `fullscreen_restored`/`tab_visible` echoes `resume` — this makes
the **server-enforcement UX real in dev** without a backend. `LiveKitLiveSession` is a stub that throws
`NotImplementedError` until wired (mirrors the backend transport stub).

## 4. Interview-lifecycle state machine

Lives in `LiveSessionProvider` (the live route mounts it). States:

```
prejoin → checks → (user gesture: enter fullscreen) → connecting → live ⇄ paused → ending → ended
                                                                         ↑ (violation / server pause)
        error (any state on unrecoverable failure)
```

- `prejoin`: dos/don'ts + AI notice + T&C + camera/mic preview; **Continue** is gated on T&C + a working mic+cam.
- `checks`: run system checks (mic/cam permission & presence, external-display). On pass → request fullscreen (user gesture) → `connecting`.
- `connecting`: `session.connect()`; on `connected` → `live`.
- `live`: the interview runs; artifacts stream; controls active.
- `paused`: entered on a violation OR a server `pause` control; work area disabled + overlay; exits to `live` on `resume`.
- `ending` → `ended`: End button or `ended` control; show closing + route to report.

**Why prejoin+live share one route (`[sessionId]/live`):** fullscreen is requested at the prejoin→live
transition and must persist through the interview. A route navigation risks dropping fullscreen and the
media stream, so the whole lifecycle is one client route that transitions internal state (prejoin is its
initial view), not separate pages.

## 5. Phase designs

### FE-1 — Start & readiness (extends existing booking UI)
- `BookingForm` gains a mode toggle: **Start now** (on-demand) vs **Schedule for later** (existing slot calendar).
- **Start now** → create session + trigger prep immediately (backend "prepare-now" trigger, §8). `SessionsList` + `StatusPill` already poll status; when a session reaches `PREP_READY`, its row shows a **Join** button → `[sessionId]/live`.
- Uses existing `features/interview` (types/api/hooks) + TanStack Query polling. Minimal new UI.

### FE-2 — Prejoin & system checks (view within `[sessionId]/live`, state `prejoin`/`checks`)
- **Left panel:** dos & don'ts list; a clear "You'll be speaking with an AI interviewer" notice; the fullscreen/violation rules; T&C checkbox.
- **Right panel:** live camera preview (from `session.getLocalStream()`), cam on/off + mic on/off toggles.
- **System checks:** mic present + permission, camera present + permission, **external-display detection** (Window Management API `getScreenDetails()`/`screen.isExtended` where available — best-effort, see §7). Each check shows pass/fail with remediation text.
- **Continue** (enabled only when T&C agreed + mic+cam OK) → request fullscreen (user gesture) → run checks → `connecting`.

### FE-3 — Live shell (Meet-like) (state `live`)
- **Layout:** work area **80%** (left) / participant rail **20%** (right).
- **Work area:** a sidebar with two options — **Code Editor** (Monaco) and **Excalidraw** — toggled; the active surface fills the area. A **fullscreen/expand icon (bottom-left)** opens the surface as a **~95% overlay "popup"** over the current window (bordered, modal-like), with a collapse control.
- **Participant rail:** candidate **camera tile** + AI **avatar bubble** (Google-avatars style: persona initial on a colored circle). **Speaking-glow:** the tile/bubble border glows while that party speaks — candidate from a local Web-Audio `AnalyserNode` mic level; AI from the seam's `speaking` control signal.
- **Bottom drawer:** End, mic mute/unmute, camera hide/show, fullscreen toggle. Custom Meet-like styling (shadcn + Geist).
- **Artifact streaming:** Monaco/Excalidraw content is debounced and pushed via `session.sendArtifact(...)` (mock = no-op; real = to the agent's `current_artifact()`). Diagram is serialized to a compact text summary for the agent (see §8).

### FE-4 — Proctoring & integrity (states `live`/`paused`; server-enforced)
- **Detection:** Fullscreen API (`fullscreenchange` / `document.fullscreenElement`), tab-switch (`visibilitychange`, `window.blur`), external-display (§7).
- **Overlay:** on fullscreen-exit or tab-hidden, a **blur overlay** covers the work area: "Please return to full-screen to continue" + a **Return to full-screen** button (re-requests fullscreen on click). Work area is disabled while shown.
- **Tamper resistance (deterrence):** a `MutationObserver` on the overlay's parent re-inserts the overlay node if it's removed from the DOM; a React render-guard re-mounts it; removal attempts emit an `overlay_tamper` proctor event. Honest limit (§7): this deters, it does not make the DOM un-editable.
- **Violation model:** each exit/tab-switch/tamper increments a violation counter (shown/logged) and enters `paused`; `sendProctorEvent` notifies the server, which gates progress (via `pause`/`resume` control signals) so **client tampering can't advance the interview**. The AI-acknowledgment control signal is handled (transcript note); its *spoken* reaction is deferred to A + a brain hook.

### FE-5 — Report placeholder (`[sessionId]/report`)
- Basic page: shows `ended_reason` + "Your report is being prepared." Real scorecard renders when sub-project E exists. Keeps the end-to-end route navigable.

## 6. Folder structure (following existing conventions)

```
features/interview-live/
  session/   LiveSession.ts (interface) · MockLiveSession.ts · LiveKitLiveSession.ts (stub)
             · LiveSessionProvider.tsx · useLiveSession.ts · machine.ts (lifecycle state machine)
  media/     useLocalMedia.ts (getUserMedia) · useSpeakingLevel.ts (Web Audio) · CameraTile.tsx · AvatarBubble.tsx
  proctor/   useFullscreen.ts · useVisibility.ts · useExternalDisplay.ts · useProctor.ts (aggregate + violations)
             · ViolationOverlay.tsx (MutationObserver-guarded)
  work/      CodeEditor.tsx (Monaco) · DiagramBoard.tsx (Excalidraw) · WorkArea.tsx (sidebar + 80/20 + popout)
  controls/  BottomDrawer.tsx
  types.ts · api.ts · hooks.ts · index.ts
app/(app)/interviews/
  _components/BookingForm.tsx        # FE-1: extend with Start-now vs Schedule
  [sessionId]/live/page.tsx          # FE-2/3/4: hosts LiveSessionProvider + the lifecycle (prejoin→live→ended)
  [sessionId]/live/_components/      # PrejoinView, ChecksView, LiveView, EndedView
  [sessionId]/report/page.tsx        # FE-5: placeholder
```

`[sessionId]/live/page.tsx` is a Client Component (WebRTC/media/fullscreen). Server Components elsewhere per convention.

## 7. Feasibility caveats (explicit)

- **Overlay tamper-resistance is deterrence, not a guarantee.** A user with DevTools can edit DOM/JS. Mitigations: MutationObserver re-insert + React guard + `overlay_tamper` telemetry. The **real** integrity guarantee is server-side: the session is `paused` server-side and the AI won't advance until fullscreen is restored, so tampering can't progress the interview.
- **External-display detection is best-effort.** Reliable only via the Window Management API (`getScreenDetails()` / `screen.isExtended`, Chromium + permission). Where unavailable, the check degrades to a warning, not a hard block.
- **AI acknowledging a violation mid-sentence is deferred.** The frontend emits the violation and the control contract carries `acknowledge_violation`; the AI's *spoken* interjection needs sub-project A (data channel) + a brain violation-hook (the brain currently has no violation input).

## 8. Backend touchpoints (thin A-slices — designed against the seam, stubbed now)

Flagged as sub-project-A dependencies; the frontend builds against the seam and the `MockLiveSession`
covers them in dev. Real versions land with A:
- **Prepare-now trigger** (FE-1 on-demand Start) — the idempotent prep re-trigger largely exists in Pipeline 1.
- **Room/token endpoint** — returns a LiveKit token/room for `session.connect()` (mock returns a fake).
- **Artifact sync** — POST `ArtifactSnapshot` → the agent's `current_artifact()` (mock = no-op).
- **Proctor/fullscreen state** — POST `ProctorEvent`; server gates session progress (mock echoes pause/resume).

## 9. New dependencies (per CLAUDE.md, flagged)

- `@monaco-editor/react` (+ `monaco-editor`) — code editor (FE-3).
- `@excalidraw/excalidraw` — diagram board (FE-3).
- `livekit-client` — **deferred** until the real `LiveKitLiveSession` is wired (A/D); the stub needs no dep. (Confirm exact versions/APIs via context7 at plan time.)

## 10. Testing strategy

- **vitest + @testing-library/react** (repo's existing setup). No real media/LiveKit in tests — inject `MockLiveSession` via the provider.
- **State machine** (`machine.ts`): pure transition tests (prejoin→checks→connecting→live⇄paused→ended; violation → paused → resume).
- **Proctor hooks**: simulate `fullscreenchange`/`visibilitychange` events → assert overlay shown, violation counted, `sendProctorEvent` called, work area disabled; assert the MutationObserver re-inserts a removed overlay.
- **Speaking-glow**: feed a fake analyser level / `speaking` control → assert glow state.
- **FE-1**: Start-now triggers prep; Join appears on `PREP_READY` (mock the query).
- **Components** render + interaction (toggles, sidebar switch, popout) with the mock session.

## 11. Out of scope (v1)

Real LiveKit transport + STT/LLM/TTS voice (A/D); the authoritative scorecard (E); the AI's spoken
violation reaction; recording/egress; mobile layout (desktop-first for a proctored coding interview).
