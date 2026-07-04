# Frontend Live-Interview Experience — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the candidate's live-interview frontend — Start → prep → Join → prejoin/system-checks → proctored Meet-like interview (code + diagram) → report — in `interviewIQ-frontend`, against a mockable `LiveSession` seam so it works end-to-end today and swaps in real LiveKit/voice later untouched.

**Architecture:** A `LiveSession` TypeScript interface abstracts the live connection (`MockLiveSession` for dev/tests, `LiveKitLiveSession` stub for later). A lifecycle state machine (`prejoin → checks → connecting → live ⇄ paused → ending → ended`) lives in a `LiveSessionProvider`. The whole interview is ONE client route (`[sessionId]/live`) rendered as a full-viewport overlay that escapes the app sidebar chrome, so fullscreen + media persist. Proctoring is client detection (fullscreen/tab/overlay) + `sendProctorEvent` to the seam (server gating is an A-slice, mocked). Editors are Monaco + Excalidraw, dynamically imported (`ssr:false`).

**Tech Stack:** Next.js 16 App Router, React 19, TanStack Query v5, Zod v4, shadcn (new-york/neutral) + Geist tokens, vitest 2 + @testing-library. New deps: `@monaco-editor/react` + `monaco-editor`, `@excalidraw/excalidraw`. `livekit-client` is deferred (stub needs no dep).

**Spec:** `docs/superpowers/specs/2026-07-04-frontend-live-interview-design.md`.

## Global Constraints

- **Branch:** `feat/live-interview-ui` (current). Commit only files a task names; never `git add -A`/`.`/`-am` (the branch carries other WIP). Personal git identity is already configured.
- **`LiveSession` seam is the ONLY place LiveKit is referenced.** UI/hooks depend on the interface, never on `livekit-client`. Tests inject `MockLiveSession` via the provider — never mock `apiFetch` for live-session behavior.
- **Server Components by default; `"use client"` only where hooks/media/interaction/fullscreen are needed** (all of `features/interview-live/*`, the live route, and interactive `_components`).
- **API calls go through `apiFetch<T>(path, { json })`** from `@/lib/api-client/client`; query keys live in `lib/constants/interview/index.ts` (`INTERVIEW_QUERY_KEYS`); hooks live in `features/*/hooks.ts` and invalidate keys `onSuccess`. Base URL = `NEXT_PUBLIC_API_URL`.
- **Types from the generated schema** (`lib/api-client/generated/schema.d.ts`) — never hand-write API DTOs. `SessionStatus` today = `SCHEDULED|PREP_QUEUED|PREP_READY|PREP_FAILED` (no live states — live lifecycle is client-side in the machine).
- **shadcn:** new-york style, baseColor `neutral`, `cn` from `@/lib/utils/cn`. Geist: dark-first, hairline borders, `font-mono` for numerals/IDs, do NOT add `@geist-ui/core`.
- **No code execution / no test-case running** anywhere (MVP). Editors are read/edited + snapshotted, never run.
- **Integrity model:** client detection + overlay deterrence (MutationObserver re-insert) + emit events to the seam for server gating. Client tamper-resistance is best-effort by design (spec §7).
- **New deps are a CLAUDE.md stop-and-ask item — the user has approved Monaco + Excalidraw for this feature (spec §9); document in each PR.**
- **Test runner:** `npm run test` (vitest). Editors/media are dynamically imported/browser-only — mock them in tests (below).

---

## Shared interfaces (authoritative — every task matches these)

```ts
// features/interview-live/session/types.ts  (Task 2)
export type Speaker = 'candidate' | 'interviewer'
export type ConnState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
export type ArtifactKind = 'code' | 'diagram'

export interface ProctorEvent {
  type: 'fullscreen_exit' | 'fullscreen_restored' | 'tab_hidden' | 'tab_visible'
      | 'external_display_detected' | 'overlay_tamper'
  at: number
}
export interface ArtifactSnapshot { kind: ArtifactKind; content: string; language?: string }
export type ControlSignal =
  | { type: 'interviewer_utterance'; text: string }
  | { type: 'speaking'; who: Speaker; speaking: boolean }
  | { type: 'pause'; reason: string }
  | { type: 'resume' }
  | { type: 'acknowledge_violation'; text?: string }
  | { type: 'ended'; reason: string }

export interface LiveSession {
  connect(sessionId: string): Promise<void>
  disconnect(): Promise<void>
  readonly connectionState: ConnState
  getLocalStream(): MediaStream | null
  setMicEnabled(on: boolean): void
  setCameraEnabled(on: boolean): void
  sendArtifact(a: ArtifactSnapshot): void
  sendProctorEvent(e: ProctorEvent): void
  onControl(cb: (c: ControlSignal) => void): () => void        // returns unsubscribe
  onConnectionChange(cb: (s: ConnState) => void): () => void
}

// features/interview-live/session/machine.ts  (Task 3)
export type LiveState = 'prejoin' | 'checks' | 'connecting' | 'live' | 'paused' | 'ending' | 'ended' | 'error'
export type LiveEvent =
  | { type: 'START_CHECKS' } | { type: 'CHECKS_PASSED' } | { type: 'CHECKS_FAILED' }
  | { type: 'CONNECTED' } | { type: 'PAUSE'; reason: string } | { type: 'RESUME' }
  | { type: 'END' } | { type: 'ENDED' } | { type: 'ERROR' }
export interface LiveContext { pausedReason: string | null; endedReason: string | null; violations: number }
export function initialMachine(): { state: LiveState; ctx: LiveContext }
export function transition(state: LiveState, ctx: LiveContext, event: LiveEvent): { state: LiveState; ctx: LiveContext }

// features/interview-live/session/LiveSessionProvider.tsx  (Task 6)
export function LiveSessionProvider(props: { sessionId: string; session?: LiveSession; children: React.ReactNode }): JSX.Element
export function useLiveSession(): {
  session: LiveSession; state: LiveState; ctx: LiveContext; send: (e: LiveEvent) => void
  speaking: Record<Speaker, boolean>; transcript: string[]
}

// features/interview-live/media/useLocalMedia.ts (Task 4)
export function useLocalMedia(session: LiveSession): { stream: MediaStream | null; micOn: boolean; camOn: boolean; toggleMic: () => void; toggleCam: () => void; error: string | null }
// features/interview-live/media/useSpeakingLevel.ts (Task 4)
export function useSpeakingLevel(stream: MediaStream | null, enabled: boolean): boolean   // true while speaking (mic level over threshold)

// features/interview-live/proctor/*  (Tasks 10, 17, 18)
export function useExternalDisplay(): { extended: boolean | null; supported: boolean }
export function useFullscreen(ref: React.RefObject<HTMLElement>): { isFullscreen: boolean; request: () => Promise<void>; exit: () => Promise<void> }
export function useVisibility(): { hidden: boolean }
export function useProctor(args: { session: LiveSession; enabled: boolean; onViolation: (e: ProctorEvent) => void }): { violations: number; active: boolean }

// features/interview-live/work/summarizeScene.ts (Task 13)
export function summarizeScene(elements: readonly unknown[]): string   // readable text summary of an Excalidraw scene for the artifact
```

## File structure

```
features/interview-live/
  session/  types.ts · machine.ts · MockLiveSession.ts · LiveKitLiveSession.ts · LiveSessionProvider.tsx · useLiveSession.ts
  media/    useLocalMedia.ts · useSpeakingLevel.ts · CameraTile.tsx · AvatarBubble.tsx
  proctor/  useExternalDisplay.ts · useFullscreen.ts · useVisibility.ts · useProctor.ts · ViolationOverlay.tsx
  work/     summarizeScene.ts · CodeEditor.tsx · DiagramBoard.tsx · WorkArea.tsx
  controls/ BottomDrawer.tsx
  index.ts
app/(app)/interviews/
  _components/BookingForm.tsx        # FE-1 (modify)
  _components/SessionsList.tsx       # FE-1 (modify)
  [sessionId]/live/page.tsx          # FE-2 (modify → client shell)
  [sessionId]/live/_components/      # LiveInterview.tsx · PrejoinView.tsx · ChecksView.tsx · LiveView.tsx · EndedView.tsx
  [sessionId]/report/page.tsx        # FE-5 (modify)
lib/constants/interview/index.ts     # add live constants (modify)
vitest.setup.ts                      # add media/fullscreen stubs (modify)
```

---

## Phase 0 — Foundation (the seam, machine, media, provider)

### Task 1: Dependencies, shadcn components, test stubs

**Files:** Modify `package.json` (deps), `vitest.setup.ts`; add shadcn `switch`, `checkbox`, `toggle`, `toggle-group`.

**Interfaces:** Produces the runtime deps + test doubles all later tasks rely on.

- [ ] **Step 1: Install deps**

Run: `npm i @monaco-editor/react monaco-editor @excalidraw/excalidraw` then `npx shadcn@2.10 add switch checkbox toggle toggle-group` (accept defaults; they land in `components/ui/`). Do NOT install `livekit-client` (deferred).

- [ ] **Step 2: Add media + fullscreen test stubs to `vitest.setup.ts`**

Append (jsdom lacks these; tests need them):

```ts
// --- live-interview media/fullscreen stubs (jsdom has none) ---
class FakeMediaStreamTrack { kind = 'audio'; enabled = true; stop() {} }
class FakeMediaStream {
  private tracks: FakeMediaStreamTrack[]
  constructor(kinds: string[] = ['audio', 'video']) {
    this.tracks = kinds.map((k) => Object.assign(new FakeMediaStreamTrack(), { kind: k }))
  }
  getTracks() { return this.tracks }
  getAudioTracks() { return this.tracks.filter((t) => t.kind === 'audio') }
  getVideoTracks() { return this.tracks.filter((t) => t.kind === 'video') }
}
;(globalThis as any).MediaStream = FakeMediaStream
Object.defineProperty(globalThis.navigator, 'mediaDevices', {
  configurable: true,
  value: { getUserMedia: vi.fn(async () => new FakeMediaStream()) },
})
Object.defineProperty(document, 'fullscreenElement', { configurable: true, writable: true, value: null })
document.documentElement.requestFullscreen = vi.fn(async function (this: HTMLElement) {
  ;(document as any).fullscreenElement = this
})
document.exitFullscreen = vi.fn(async () => { ;(document as any).fullscreenElement = null })
;(globalThis as any).AudioContext = class {
  createAnalyser() { return { fftSize: 0, frequencyBinCount: 32, getByteTimeDomainData: (a: Uint8Array) => a.fill(128) } }
  createMediaStreamSource() { return { connect() {} } }
  close() {}
}
```

Add `import { vi } from 'vitest'` at the top of `vitest.setup.ts` if not already global (globals are on, but `vi` in setup needs the import).

- [ ] **Step 3: Verify install + suite still green**

Run: `npm run test -- --run` → existing tests pass; `npx tsc --noEmit` → no new errors from deps.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json vitest.setup.ts components/ui/switch.tsx components/ui/checkbox.tsx components/ui/toggle.tsx components/ui/toggle-group.tsx
git commit -m "chore(interview-live): add Monaco+Excalidraw deps, shadcn switch/checkbox/toggle, media test stubs"
```

---

### Task 2: `LiveSession` seam types

**Files:** Create `features/interview-live/session/types.ts`; Test `features/interview-live/session/types.test.ts`.

**Interfaces:** Produces all types in the Shared-interfaces block for `types.ts`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest'
import type { LiveSession, ControlSignal, ProctorEvent, ArtifactSnapshot } from './types'

it('control signals + artifact + proctor event shapes compile and construct', () => {
  const c: ControlSignal = { type: 'speaking', who: 'interviewer', speaking: true }
  const a: ArtifactSnapshot = { kind: 'code', content: 'x=1', language: 'python' }
  const p: ProctorEvent = { type: 'fullscreen_exit', at: 1 }
  expect(c.type).toBe('speaking'); expect(a.kind).toBe('code'); expect(p.type).toBe('fullscreen_exit')
  const _assert: LiveSession | null = null   // interface is importable as a type
  expect(_assert).toBeNull()
})
```

- [ ] **Step 2: Run → FAIL** (`Cannot find module './types'`). Run: `npm run test -- --run features/interview-live/session/types.test.ts`

- [ ] **Step 3: Implement** — create `types.ts` exactly as the Shared-interfaces `types.ts` block (Speaker, ConnState, ArtifactKind, ProctorEvent, ArtifactSnapshot, ControlSignal, LiveSession).

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** `git add features/interview-live/session/types.ts features/interview-live/session/types.test.ts && git commit -m "feat(interview-live): LiveSession seam types"`

---

### Task 3: Lifecycle state machine (`machine.ts`)

**Files:** Create `features/interview-live/session/machine.ts`; Test `machine.test.ts`.

**Interfaces:** Consumes types (Task 2). Produces `LiveState`, `LiveEvent`, `LiveContext`, `initialMachine()`, `transition()`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest'
import { initialMachine, transition } from './machine'

it('happy path prejoin → checks → connecting → live', () => {
  let { state, ctx } = initialMachine()
  expect(state).toBe('prejoin')
  ;({ state, ctx } = transition(state, ctx, { type: 'START_CHECKS' })); expect(state).toBe('checks')
  ;({ state, ctx } = transition(state, ctx, { type: 'CHECKS_PASSED' })); expect(state).toBe('connecting')
  ;({ state, ctx } = transition(state, ctx, { type: 'CONNECTED' })); expect(state).toBe('live')
})
it('pause/resume from live counts a violation', () => {
  let s = { state: 'live' as const, ctx: { pausedReason: null, endedReason: null, violations: 0 } }
  s = transition(s.state, s.ctx, { type: 'PAUSE', reason: 'fullscreen_exit' })
  expect(s.state).toBe('paused'); expect(s.ctx.violations).toBe(1); expect(s.ctx.pausedReason).toBe('fullscreen_exit')
  s = transition(s.state, s.ctx, { type: 'RESUME' }); expect(s.state).toBe('live'); expect(s.ctx.pausedReason).toBeNull()
})
it('END from live → ending → ended; ENDED sets reason', () => {
  let s = transition('live', { pausedReason: null, endedReason: null, violations: 0 }, { type: 'END' })
  expect(s.state).toBe('ending')
  s = transition(s.state, s.ctx, { type: 'ENDED' }); expect(s.state).toBe('ended')
})
it('ignores illegal transitions (CONNECTED while prejoin stays prejoin)', () => {
  const s = transition('prejoin', { pausedReason: null, endedReason: null, violations: 0 }, { type: 'CONNECTED' })
  expect(s.state).toBe('prejoin')
})
it('checks_failed returns to prejoin', () => {
  const s = transition('checks', { pausedReason: null, endedReason: null, violations: 0 }, { type: 'CHECKS_FAILED' })
  expect(s.state).toBe('prejoin')
})
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement `machine.ts`**

```ts
import type { Speaker } from './types'

export type LiveState = 'prejoin' | 'checks' | 'connecting' | 'live' | 'paused' | 'ending' | 'ended' | 'error'
export type LiveEvent =
  | { type: 'START_CHECKS' } | { type: 'CHECKS_PASSED' } | { type: 'CHECKS_FAILED' }
  | { type: 'CONNECTED' } | { type: 'PAUSE'; reason: string } | { type: 'RESUME' }
  | { type: 'END' } | { type: 'ENDED' } | { type: 'ERROR' }
export interface LiveContext { pausedReason: string | null; endedReason: string | null; violations: number }

export function initialMachine(): { state: LiveState; ctx: LiveContext } {
  return { state: 'prejoin', ctx: { pausedReason: null, endedReason: null, violations: 0 } }
}

export function transition(state: LiveState, ctx: LiveContext, event: LiveEvent): { state: LiveState; ctx: LiveContext } {
  // ERROR is always reachable
  if (event.type === 'ERROR') return { state: 'error', ctx }
  switch (state) {
    case 'prejoin':
      if (event.type === 'START_CHECKS') return { state: 'checks', ctx }
      break
    case 'checks':
      if (event.type === 'CHECKS_PASSED') return { state: 'connecting', ctx }
      if (event.type === 'CHECKS_FAILED') return { state: 'prejoin', ctx }
      break
    case 'connecting':
      if (event.type === 'CONNECTED') return { state: 'live', ctx }
      break
    case 'live':
      if (event.type === 'PAUSE') return { state: 'paused', ctx: { ...ctx, pausedReason: event.reason, violations: ctx.violations + 1 } }
      if (event.type === 'END') return { state: 'ending', ctx }
      if (event.type === 'ENDED') return { state: 'ended', ctx }
      break
    case 'paused':
      if (event.type === 'RESUME') return { state: 'live', ctx: { ...ctx, pausedReason: null } }
      if (event.type === 'END') return { state: 'ending', ctx }
      if (event.type === 'ENDED') return { state: 'ended', ctx }
      break
    case 'ending':
      if (event.type === 'ENDED') return { state: 'ended', ctx: { ...ctx, endedReason: ctx.endedReason ?? 'completed' } }
      break
  }
  return { state, ctx }   // illegal transition → no-op
}
```

- [ ] **Step 4: Run → PASS.** **Step 5: Commit** (`feat(interview-live): lifecycle state machine`).

---

### Task 4: Local media + speaking-level hooks

**Files:** Create `features/interview-live/media/useLocalMedia.ts`, `media/useSpeakingLevel.ts`; Tests `useLocalMedia.test.tsx`, `useSpeakingLevel.test.tsx`.

**Interfaces:** Consumes `LiveSession` (Task 2). Produces `useLocalMedia`, `useSpeakingLevel` (signatures in Shared block).

- [ ] **Step 1: Failing test (`useLocalMedia.test.tsx`)**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLocalMedia } from './useLocalMedia'
import type { LiveSession } from '../session/types'

function fakeSession(): LiveSession {
  return {
    connect: vi.fn(), disconnect: vi.fn(), connectionState: 'connected',
    getLocalStream: () => new MediaStream(['audio', 'video']) as unknown as MediaStream,
    setMicEnabled: vi.fn(), setCameraEnabled: vi.fn(),
    sendArtifact: vi.fn(), sendProctorEvent: vi.fn(), onControl: () => () => {}, onConnectionChange: () => () => {},
  }
}
it('toggles mic/cam and calls the session', () => {
  const s = fakeSession()
  const { result } = renderHook(() => useLocalMedia(s))
  expect(result.current.micOn).toBe(true)
  act(() => result.current.toggleMic())
  expect(result.current.micOn).toBe(false)
  expect(s.setMicEnabled).toHaveBeenCalledWith(false)
})
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement**

`useLocalMedia.ts`:
```ts
'use client'
import { useCallback, useState } from 'react'
import type { LiveSession } from '../session/types'

export function useLocalMedia(session: LiveSession) {
  const [stream] = useState<MediaStream | null>(() => session.getLocalStream())
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)
  const [error] = useState<string | null>(null)
  const toggleMic = useCallback(() => setMicOn((on) => { session.setMicEnabled(!on); return !on }), [session])
  const toggleCam = useCallback(() => setCamOn((on) => { session.setCameraEnabled(!on); return !on }), [session])
  return { stream, micOn, camOn, toggleMic, toggleCam, error }
}
```

`useSpeakingLevel.ts` (Web Audio; polls the analyser via rAF while enabled):
```ts
'use client'
import { useEffect, useRef, useState } from 'react'

export function useSpeakingLevel(stream: MediaStream | null, enabled: boolean): boolean {
  const [speaking, setSpeaking] = useState(false)
  const raf = useRef<number | null>(null)
  useEffect(() => {
    if (!stream || !enabled || typeof AudioContext === 'undefined') { setSpeaking(false); return }
    const ctx = new AudioContext()
    const src = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    src.connect(analyser)
    const buf = new Uint8Array(analyser.frequencyBinCount)
    const tick = () => {
      analyser.getByteTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v }
      setSpeaking(Math.sqrt(sum / buf.length) > 0.04)   // RMS threshold
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => { if (raf.current) cancelAnimationFrame(raf.current); ctx.close() }
  }, [stream, enabled])
  return speaking
}
```

(The `useSpeakingLevel` test asserts it returns `false` with a null stream and does not throw with the stubbed AudioContext; requestAnimationFrame is provided by jsdom.)

- [ ] **Step 4: Run → PASS. Step 5: Commit** (`feat(interview-live): local media + speaking-level hooks`).

---

### Task 5: `MockLiveSession`

**Files:** Create `features/interview-live/session/MockLiveSession.ts`; Test `MockLiveSession.test.ts`.

**Interfaces:** Implements `LiveSession`. Consumed by the provider (Task 6) + all UI tests.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, vi } from 'vitest'
import { MockLiveSession } from './MockLiveSession'

it('connect acquires media, emits interviewer opening + speaking, exposes stream', async () => {
  const s = new MockLiveSession()
  const controls: any[] = []
  s.onControl((c) => controls.push(c))
  await s.connect('sess-1')
  expect(s.connectionState).toBe('connected')
  expect(s.getLocalStream()).not.toBeNull()
  expect(controls.some((c) => c.type === 'interviewer_utterance')).toBe(true)
})
it('echoes pause on a fullscreen_exit proctor event and resume on restored', () => {
  const s = new MockLiveSession()
  const controls: any[] = []
  s.onControl((c) => controls.push(c))
  s.sendProctorEvent({ type: 'fullscreen_exit', at: 1 })
  expect(controls.some((c) => c.type === 'pause')).toBe(true)
  s.sendProctorEvent({ type: 'fullscreen_restored', at: 2 })
  expect(controls.some((c) => c.type === 'resume')).toBe(true)
})
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement**

```ts
import type { ArtifactSnapshot, ConnState, ControlSignal, LiveSession, ProctorEvent, Speaker } from './types'

type Cb<T> = (v: T) => void

/** Dev/test double for LiveSession: real getUserMedia, scripted interviewer turns, and echoes the
 * server-side pause/resume gating in response to proctor events — so the whole UI + proctoring flow
 * works with no backend. Swapped for LiveKitLiveSession when sub-projects A/D land. */
export class MockLiveSession implements LiveSession {
  connectionState: ConnState = 'idle'
  private stream: MediaStream | null = null
  private controlCbs = new Set<Cb<ControlSignal>>()
  private connCbs = new Set<Cb<ConnState>>()

  async connect(_sessionId: string): Promise<void> {
    this.setConn('connecting')
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
    } catch {
      this.stream = null   // media denied — UI surfaces it; connection still proceeds for the mock
    }
    this.setConn('connected')
    // scripted opening
    this.emit({ type: 'interviewer_utterance', text: "Hi — thanks for joining. Let's start when you're ready." })
    this.emit({ type: 'speaking', who: 'interviewer', speaking: true })
    setTimeout(() => this.emit({ type: 'speaking', who: 'interviewer', speaking: false }), 300)
  }
  async disconnect(): Promise<void> {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.setConn('disconnected')
  }
  getLocalStream() { return this.stream }
  setMicEnabled(on: boolean) { this.stream?.getAudioTracks().forEach((t) => (t.enabled = on)) }
  setCameraEnabled(on: boolean) { this.stream?.getVideoTracks().forEach((t) => (t.enabled = on)) }
  sendArtifact(_a: ArtifactSnapshot) { /* no-op in mock; real seam POSTs to the agent */ }
  sendProctorEvent(e: ProctorEvent) {
    // mirror server-side gating: pause the interview on exit/hide, resume on restore/visible
    if (e.type === 'fullscreen_exit' || e.type === 'tab_hidden') {
      this.emit({ type: 'pause', reason: e.type })
      this.emit({ type: 'acknowledge_violation', text: "Let's keep the interview in full screen — I'll wait." })
    } else if (e.type === 'fullscreen_restored' || e.type === 'tab_visible') {
      this.emit({ type: 'resume' })
    }
  }
  onControl(cb: Cb<ControlSignal>) { this.controlCbs.add(cb); return () => this.controlCbs.delete(cb) }
  onConnectionChange(cb: Cb<ConnState>) { this.connCbs.add(cb); return () => this.connCbs.delete(cb) }
  private emit(c: ControlSignal) { this.controlCbs.forEach((cb) => cb(c)) }
  private setConn(s: ConnState) { this.connectionState = s; this.connCbs.forEach((cb) => cb(s)) }
}
```

- [ ] **Step 4: Run → PASS. Step 5: Commit** (`feat(interview-live): MockLiveSession (getUserMedia + scripted control + proctor echo)`).

---

### Task 6: `LiveKitLiveSession` stub + `LiveSessionProvider` + `useLiveSession`

**Files:** Create `session/LiveKitLiveSession.ts`, `session/LiveSessionProvider.tsx`, `session/useLiveSession.ts`; Test `LiveSessionProvider.test.tsx`.

**Interfaces:** Produces `LiveSessionProvider`, `useLiveSession` (Shared block). The provider owns the machine, subscribes to the session's control signals (mapping `pause`/`resume`/`ended`/`speaking`/`interviewer_utterance` into machine events + local speaking/transcript state).

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { LiveSessionProvider, useLiveSession } from './LiveSessionProvider'
import { MockLiveSession } from './MockLiveSession'

function Probe() {
  const { state, send, ctx } = useLiveSession()
  return (
    <div>
      <span data-testid="state">{state}</span>
      <span data-testid="violations">{ctx.violations}</span>
      <button onClick={() => send({ type: 'START_CHECKS' })}>checks</button>
    </div>
  )
}
it('provides machine state and routes a session pause into the paused state', async () => {
  const session = new MockLiveSession()
  render(<LiveSessionProvider sessionId="s1" session={session}><Probe /></LiveSessionProvider>)
  expect(screen.getByTestId('state').textContent).toBe('prejoin')
  // force to live, then a pause control → paused + violation
  await act(async () => { await session.connect('s1') })
  // drive machine to live via the provider's own connect handling is covered elsewhere; here assert pause mapping
})
```

(Keep the provider test focused: assert it renders `prejoin` initially and that `useLiveSession` throws outside a provider. Deeper control-signal→machine wiring is exercised in the LiveView tests, Task 16/19.)

- [ ] **Step 2: Run → FAIL. Step 3: Implement**

`LiveKitLiveSession.ts` (stub, mirrors backend transport stub):
```ts
import type { LiveSession } from './types'
export class LiveKitLiveSession implements LiveSession {
  // Real implementation lands with sub-projects A (LiveKit rooms/token) + D (voice). Until then, unused.
  connectionState = 'idle' as const
  private nie(): never { throw new Error('LiveKitLiveSession not implemented — see spec sub-projects A + D') }
  connect() { return this.nie() }
  disconnect() { return this.nie() }
  getLocalStream() { return this.nie() }
  setMicEnabled() { this.nie() }
  setCameraEnabled() { this.nie() }
  sendArtifact() { this.nie() }
  sendProctorEvent() { this.nie() }
  onControl() { return this.nie() }
  onConnectionChange() { return this.nie() }
}
```

`LiveSessionProvider.tsx`:
```tsx
'use client'
import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { LiveSession, Speaker } from './types'
import { MockLiveSession } from './MockLiveSession'
import { initialMachine, transition, type LiveContext, type LiveEvent, type LiveState } from './machine'

interface Ctx {
  session: LiveSession; state: LiveState; ctx: LiveContext; send: (e: LiveEvent) => void
  speaking: Record<Speaker, boolean>; transcript: string[]
}
const LiveCtx = createContext<Ctx | null>(null)

export function LiveSessionProvider({ sessionId, session, children }: { sessionId: string; session?: LiveSession; children: React.ReactNode }) {
  const sessionRef = useRef<LiveSession>(session ?? new MockLiveSession())
  const [{ state, ctx }, dispatch] = useReducer(
    (s: { state: LiveState; ctx: LiveContext }, e: LiveEvent) => transition(s.state, s.ctx, e),
    undefined, initialMachine,
  )
  const send = (e: LiveEvent) => dispatch(e)
  const [speaking, setSpeaking] = useState<Record<Speaker, boolean>>({ candidate: false, interviewer: false })
  const [transcript, setTranscript] = useState<string[]>([])

  useEffect(() => {
    const s = sessionRef.current
    const off = s.onControl((c) => {
      if (c.type === 'pause') send({ type: 'PAUSE', reason: c.reason })
      else if (c.type === 'resume') send({ type: 'RESUME' })
      else if (c.type === 'ended') send({ type: 'ENDED' })
      else if (c.type === 'speaking') setSpeaking((prev) => ({ ...prev, [c.who]: c.speaking }))
      else if (c.type === 'interviewer_utterance') setTranscript((t) => [...t, c.text])
    })
    return off
  }, [])

  const value = useMemo<Ctx>(() => ({ session: sessionRef.current, state, ctx, send, speaking, transcript }), [state, ctx, speaking, transcript])
  return <LiveCtx.Provider value={value}>{children}</LiveCtx.Provider>
}

export function useLiveSession(): Ctx {
  const v = useContext(LiveCtx)
  if (!v) throw new Error('useLiveSession must be used within a LiveSessionProvider')
  return v
}
```

`useLiveSession.ts` — re-export for import ergonomics: `export { useLiveSession } from './LiveSessionProvider'`.

- [ ] **Step 4: Run → PASS. Step 5: Commit** (`feat(interview-live): provider + machine wiring + LiveKit stub`).

---

## Phase 1 — FE-1: Start & readiness

### Task 7: `useSession(id)` hook + on-demand start helper

**Files:** Modify `features/interview/api.ts` (none — `getSession` exists), `features/interview/hooks.ts` (add `useSession`), `lib/constants/interview/index.ts` (already has `session(id)` key + `sessionsIntervalMs`); Test `features/interview/hooks.test.tsx`.

**Interfaces:** Produces `useSession(id)` (polls a single session while status is SCHEDULED/PREP_QUEUED). On-demand "Start now" reuses the existing `useCreateSession()` with `scheduledAt = now + buffer`.

- [ ] **Step 1: Failing test** (mirror `features/profile/hooks/useProfile.test.tsx`): mock `@/lib/api-client/client`'s `apiFetch`, `renderHook(() => useSession('abc'), { wrapper })`, assert it calls `GET /api/v1/interviews/sessions/abc` and returns data.

- [ ] **Step 2: Run → FAIL. Step 3: Implement** — add to `features/interview/hooks.ts`:

```ts
export function useSession(id: string) {
  return useQuery<InterviewSession>({
    queryKey: INTERVIEW_QUERY_KEYS.session(id),
    queryFn: () => getSession(id),
    enabled: !!id,
    refetchInterval: (query) => {
      const st = query.state.data?.status
      return st === 'SCHEDULED' || st === 'PREP_QUEUED' ? INTERVIEW_POLLING.sessionsIntervalMs : false
    },
  })
}
```
(Import `getSession` + `INTERVIEW_QUERY_KEYS`/`INTERVIEW_POLLING` at the top; `InterviewSession` type already imported.)

- [ ] **Step 4: Run → PASS. Step 5: Commit** (`feat(interview): useSession(id) polling hook`).

---

### Task 8: BookingForm — "Start now" vs "Schedule for later"

**Files:** Modify `app/(app)/interviews/_components/BookingForm.tsx`; Test `BookingForm.test.tsx`.

**Interfaces:** Consumes `useCreateSession`, `useJds`. On "Start now", builds `CreateInterviewSessionRequest` with `scheduledAt = new Date(Date.now() + 60_000).toISOString()` (small buffer so the backend's past-slot guard passes; prep triggers on the next poll — the real "prepare-now" endpoint is a sub-project-A refinement, noted). On "Schedule for later", keeps the existing calendar+slot path.

- [ ] **Step 1: Failing test** — render `BookingForm` (mock `@/features/interview` hooks + `@/features/jobs`); assert a mode toggle exists (Start now / Schedule); selecting a role + clicking **Start now** calls `create.mutate` with a `scheduledAt` within ~2 min of now and a `timezone`.

- [ ] **Step 2: Run → FAIL. Step 3: Implement** — add a `toggle-group` (mode: `now | schedule`) at the top; when `now`, hide the calendar/slot grid and show a single **Start now** button whose handler builds the near-now body; when `schedule`, the existing UI. Reuse the existing `create.mutate(body, { onSuccess: toast + reset, onError: toast })`. Keep `roundType` unset.

- [ ] **Step 4: Run → PASS. Step 5: Commit** (`feat(interviews): on-demand Start now + Schedule toggle on BookingForm`).

---

### Task 9: SessionsList — Join button on PREP_READY

**Files:** Modify `app/(app)/interviews/_components/SessionsList.tsx`; Test `SessionsList.test.tsx`.

- [ ] **Step 1: Failing test** — mock `useMySessions` to return one session with `status: 'PREP_READY'`; assert a link/button "Join" with `href="/interviews/{id}/live"` renders; and for a `SCHEDULED` session, no Join button.

- [ ] **Step 2: Run → FAIL. Step 3: Implement** — in `SessionCard`, when `session.status === 'PREP_READY'`, render `<Button asChild><Link href={\`/interviews/${session.id}/live\`}>Join</Link></Button>` (import `Link` from `next/link`). Keep the existing Retry-on-PREP_FAILED.

- [ ] **Step 4: Run → PASS. Step 5: Commit** (`feat(interviews): Join button when prep is ready`).

---

## Phase 2 — FE-2: Prejoin & system checks

### Task 10: `useExternalDisplay` hook

**Files:** Create `features/interview-live/proctor/useExternalDisplay.ts`; Test `useExternalDisplay.test.tsx`.

**Interfaces:** Produces `useExternalDisplay()` → `{ extended: boolean | null; supported: boolean }` using the Window Management API (`window.getScreenDetails()` / `screen.isExtended`), degrading to `supported:false` where unavailable.

- [ ] **Step 1: Failing test** — with no `screen.isExtended`/`getScreenDetails` on the jsdom `screen`, assert `supported === false` and `extended === null` (no throw).

- [ ] **Step 2: Run → FAIL. Step 3: Implement**

```ts
'use client'
import { useEffect, useState } from 'react'
export function useExternalDisplay() {
  const [extended, setExtended] = useState<boolean | null>(null)
  const [supported, setSupported] = useState(false)
  useEffect(() => {
    const scr = window.screen as Screen & { isExtended?: boolean }
    if (typeof scr.isExtended === 'boolean') { setSupported(true); setExtended(scr.isExtended) }
    else if (typeof (window as any).getScreenDetails === 'function') {
      setSupported(true)
      ;(window as any).getScreenDetails().then((d: any) => setExtended((d?.screens?.length ?? 1) > 1)).catch(() => setExtended(null))
    } else { setSupported(false); setExtended(null) }
  }, [])
  return { extended, supported }
}
```

- [ ] **Step 4: Run → PASS. Step 5: Commit** (`feat(interview-live): external-display detection hook`).

---

### Task 11: Live route → client shell + PrejoinView

**Files:** Modify `app/(app)/interviews/[sessionId]/live/page.tsx`; Create `[sessionId]/live/_components/LiveInterview.tsx`, `PrejoinView.tsx`; Test `LiveInterview.test.tsx`.

**Interfaces:** `page.tsx` becomes a thin client wrapper: `await params` in a server component is fine, but the interactive shell is a client component. Pattern: keep `page.tsx` a server component that reads `sessionId` and renders `<LiveInterview sessionId={sessionId} />` (client). `LiveInterview` mounts `LiveSessionProvider` and renders the view for the current machine state as a **full-viewport overlay** (`fixed inset-0 z-50 bg-background`) to escape the `(app)` sidebar chrome.

- [ ] **Step 1: Failing test** — render `<LiveInterview sessionId="s1" />` with an injected `MockLiveSession`; assert the PrejoinView content shows (dos/don'ts, the "AI interviewer" notice, a T&C checkbox, a camera preview element) and that **Continue is disabled until T&C is checked**.

- [ ] **Step 2: Run → FAIL. Step 3: Implement**
- `page.tsx`:
```tsx
import LiveInterview from './_components/LiveInterview'
export default async function LiveInterviewPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params
  return <LiveInterview sessionId={sessionId} />
}
```
- `LiveInterview.tsx` (`'use client'`): wraps children in `LiveSessionProvider`; a `LiveInterviewInner` reads `useLiveSession()` and `switch(state)` → renders `PrejoinView | ChecksView | LiveView | EndedView` inside a `fixed inset-0 z-50 flex bg-background` container. (`ChecksView`/`LiveView`/`EndedView` created in later tasks; for this task render a placeholder for non-prejoin states so the file compiles.)
- `PrejoinView.tsx` (`'use client'`): left panel = dos/don'ts list + "You'll be speaking with an AI interviewer" notice + the fullscreen/violation rules + a shadcn `Checkbox` for T&C; right panel = a `<video autoPlay muted playsInline>` bound to `session.getLocalStream()` + `Switch` toggles for mic/cam (via `useLocalMedia`). A **Continue** button (disabled until T&C checked + a stream exists) calls `send({ type: 'START_CHECKS' })`.

- [ ] **Step 4: Run → PASS. Step 5: Commit** (`feat(interview-live): live route client shell + prejoin view`).

---

### Task 12: ChecksView (system checks → fullscreen → connect)

**Files:** Create `[sessionId]/live/_components/ChecksView.tsx`; Test `ChecksView.test.tsx`.

**Interfaces:** Runs checks (mic present, camera present, external-display via `useExternalDisplay`), shows pass/fail per check; on **Enter interview** (user gesture) requests fullscreen on the overlay root, calls `session.connect(sessionId)`, and on `connected` `send({ type: 'CHECKS_PASSED' })` then `send({ type: 'CONNECTED' })`.

- [ ] **Step 1: Failing test** — render ChecksView with MockLiveSession; assert the three checks render; clicking **Enter interview** calls `requestFullscreen` (stubbed) and drives the machine toward `live` (assert `session.connect` called + a `CONNECTED` transition via a probe).

- [ ] **Step 2: Run → FAIL. Step 3: Implement** — a list of checks with status icons (reuse lucide `CheckCircle2`/`AlertTriangle`); external-display "extended" = warning (not a hard block, per spec §7); **Enter interview** handler: `await rootRef.requestFullscreen()`, `send({ type: 'CHECKS_PASSED' })`, `await session.connect(sessionId)`, then the provider's control-subscription + a local effect `send({ type: 'CONNECTED' })` once `connectionState === 'connected'`.

- [ ] **Step 4: Run → PASS. Step 5: Commit** (`feat(interview-live): system checks → fullscreen → connect`).

---

## Phase 3 — FE-3: Live shell (Meet-like)

### Task 13: Scene summarizer + Monaco + Excalidraw wrappers

**Files:** Create `features/interview-live/work/summarizeScene.ts`, `work/CodeEditor.tsx`, `work/DiagramBoard.tsx`; Test `summarizeScene.test.ts`.

**Interfaces:** `summarizeScene(elements)` → readable text (for the diagram artifact). `CodeEditor` + `DiagramBoard` are client, dynamically imported, and push snapshots via `session.sendArtifact` (debounced ~800ms).

- [ ] **Step 1: Failing test (`summarizeScene.test.ts`)**

```ts
import { describe, it, expect } from 'vitest'
import { summarizeScene } from './summarizeScene'
it('summarizes shapes + text into readable lines', () => {
  const els = [
    { type: 'rectangle', id: 'a', text: '' },
    { type: 'text', id: 't1', text: 'User Service' },
    { type: 'arrow', id: 'ar', startBinding: { elementId: 'a' }, endBinding: { elementId: 't1' } },
  ]
  const out = summarizeScene(els as any)
  expect(out).toContain('rectangle')
  expect(out).toContain('User Service')
  expect(out).toContain('arrow')
})
it('empty scene → empty-ish summary', () => { expect(summarizeScene([])).toMatch(/no|empty/i) })
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement**

`summarizeScene.ts`:
```ts
interface El { type?: string; id?: string; text?: string; startBinding?: { elementId?: string }; endBinding?: { elementId?: string } }
export function summarizeScene(elements: readonly unknown[]): string {
  const els = (elements as El[]).filter((e) => e && e.type && !(e as any).isDeleted)
  if (!els.length) return '(empty diagram — no shapes drawn yet)'
  const lines: string[] = []
  for (const e of els) {
    if (e.type === 'text' && e.text) lines.push(`text: "${e.text}"`)
    else if (e.type === 'arrow' || e.type === 'line') lines.push(`${e.type}: ${e.startBinding?.elementId ?? '?'} → ${e.endBinding?.elementId ?? '?'}`)
    else lines.push(`${e.type}${e.text ? ` "${e.text}"` : ''}${e.id ? ` [${e.id}]` : ''}`)
  }
  return lines.join('\n')
}
```

`CodeEditor.tsx` (`'use client'`) — Monaco, dynamic import, debounced snapshot:
```tsx
'use client'
import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import type { LiveSession } from '../session/types'
const Editor = dynamic(() => import('@monaco-editor/react'), { ssr: false, loading: () => <div className="h-full bg-muted animate-pulse" /> })
const LANGS = ['python', 'javascript', 'typescript', 'java', 'cpp', 'go'] as const
export function CodeEditor({ session }: { session: LiveSession }) {
  const [value, setValue] = useState('# write your solution here\n')
  const [lang, setLang] = useState<(typeof LANGS)[number]>('python')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => session.sendArtifact({ kind: 'code', content: value, language: lang }), 800)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [value, lang, session])
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b p-2">
        <select value={lang} onChange={(e) => setLang(e.target.value as any)} className="rounded border bg-background px-2 py-1 text-sm">
          {LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>
      <div className="flex-1"><Editor height="100%" language={lang} theme="vs-dark" value={value}
        onChange={(v) => setValue(v ?? '')} options={{ minimap: { enabled: false }, fontSize: 14, automaticLayout: true }} /></div>
    </div>
  )
}
```

`DiagramBoard.tsx` (`'use client'`) — Excalidraw, dynamic import, debounced summarized snapshot:
```tsx
'use client'
import dynamic from 'next/dynamic'
import { useRef } from 'react'
import '@excalidraw/excalidraw/index.css'
import type { LiveSession } from '../session/types'
import { summarizeScene } from './summarizeScene'
const Excalidraw = dynamic(async () => (await import('@excalidraw/excalidraw')).Excalidraw, { ssr: false, loading: () => <div className="h-full bg-muted animate-pulse" /> })
export function DiagramBoard({ session }: { session: LiveSession }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  return (
    <div className="h-full">
      <Excalidraw onChange={(elements) => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => session.sendArtifact({ kind: 'diagram', content: summarizeScene(elements) }), 800)
      }} />
    </div>
  )
}
```

- [ ] **Step 4: Run → PASS** (summarizeScene test; the editor components are smoke-covered via WorkArea in Task 14 with Monaco/Excalidraw mocked). **Step 5: Commit** (`feat(interview-live): scene summarizer + Monaco + Excalidraw wrappers`).

---

### Task 14: WorkArea (tabs + 80/20 split host + fullscreen pop-out)

**Files:** Create `features/interview-live/work/WorkArea.tsx`; Test `WorkArea.test.tsx` (mock `../work/CodeEditor` + `../work/DiagramBoard` to trivial divs; mock `@monaco-editor/react` + `@excalidraw/excalidraw` globally is unnecessary since we mock our wrappers).

**Interfaces:** Renders a shadcn `Tabs` (Code Editor / Excalidraw) filling the area; a bottom-left expand icon toggles a `~95% overlay popup` (`fixed inset-[2.5%] z-[60] rounded-lg border shadow-2xl`) with a collapse control.

- [ ] **Step 1: Failing test** — render WorkArea; assert both tab triggers exist; clicking the diagram tab shows the (mocked) DiagramBoard; clicking the expand icon adds the popup container (assert a `data-testid="work-popout"` appears) and collapse removes it.

- [ ] **Step 2: Run → FAIL. Step 3: Implement** — `Tabs` with `TabsList` (Code Editor, Excalidraw) + `TabsContent` hosting `<CodeEditor session/>` / `<DiagramBoard session/>`; an expand `Button size="icon"` bottom-left toggling `popped` state; when `popped`, wrap the active surface in a `fixed inset-[2.5%] z-[60]` container (the popup) with a collapse button. Keep both editors mounted (don't unmount on tab switch — Excalidraw/Monaco are expensive; use `TabsContent forceMount` + CSS hide) so artifact state persists.

- [ ] **Step 4: Run → PASS. Step 5: Commit** (`feat(interview-live): work area (code/diagram tabs + fullscreen pop-out)`).

---

### Task 15: CameraTile + AvatarBubble (speaking glow)

**Files:** Create `features/interview-live/media/CameraTile.tsx`, `media/AvatarBubble.tsx`; Test `AvatarBubble.test.tsx`.

**Interfaces:** `CameraTile` binds `session.getLocalStream()` to a muted `<video>` + glows (ring) when `useSpeakingLevel(stream, micOn)` is true. `AvatarBubble` shows the persona initial on a colored circle + glows when the `interviewer` speaking flag (from `useLiveSession().speaking`) is true.

- [ ] **Step 1: Failing test (`AvatarBubble.test.tsx`)** — render `<AvatarBubble name="Ada" speaking />`; assert the initial "A" shows and the speaking ring class is applied; with `speaking={false}` the ring is absent.

- [ ] **Step 2: Run → FAIL. Step 3: Implement** — `AvatarBubble`: a circle (`rounded-full`) with `name[0]`, `className={cn('...', speaking && 'ring-4 ring-primary/60')}`; `CameraTile`: a `<video>` (srcObject set via ref effect) with the same conditional ring driven by `useSpeakingLevel`. Google-avatar style: deterministic color from the name hash.

- [ ] **Step 4: Run → PASS. Step 5: Commit** (`feat(interview-live): camera tile + AI avatar bubble with speaking glow`).

---

### Task 16: BottomDrawer + LiveView (assemble the shell)

**Files:** Create `features/interview-live/controls/BottomDrawer.tsx`, `[sessionId]/live/_components/LiveView.tsx`; Test `LiveView.test.tsx`.

**Interfaces:** `LiveView` = the 80/20 layout: left 80% `<WorkArea session/>`, right 20% column = `<CameraTile/>` + `<AvatarBubble/>`; bottom `<BottomDrawer/>` (End, mic mute/unmute, camera hide/show, fullscreen toggle). Wires `useLocalMedia` for mic/cam, `useLiveSession().speaking` for the avatar glow. End → `send({ type: 'END' })` then `session.disconnect()` then `send({ type: 'ENDED' })`.

- [ ] **Step 1: Failing test** — render LiveView within a provider (MockLiveSession, machine forced to `live` via a test helper that dispatches to `live`); assert WorkArea tabs, the camera video element, the avatar initial, and the four drawer controls render; clicking mic toggles `micOn` (aria-pressed) and calls `session.setMicEnabled`.

- [ ] **Step 2: Run → FAIL. Step 3: Implement** — the grid (`flex`: `flex-1` work area at `w-4/5`, aside `w-1/5`); `BottomDrawer` = a bordered bar (`Button size="icon"` each) using lucide `PhoneOff`/`Mic`/`MicOff`/`Video`/`VideoOff`/`Maximize`. End handler as above.

- [ ] **Step 4: Run → PASS. Step 5: Commit** (`feat(interview-live): live view shell + bottom controls`).

---

## Phase 4 — FE-4: Proctoring & integrity

### Task 17: `useFullscreen` + `useVisibility`

**Files:** Create `features/interview-live/proctor/useFullscreen.ts`, `proctor/useVisibility.ts`; Tests `useFullscreen.test.tsx`, `useVisibility.test.tsx`.

- [ ] **Step 1: Failing tests** — `useFullscreen(ref)`: initially `isFullscreen=false`; calling `request()` (stubbed `requestFullscreen`) then firing a `fullscreenchange` event flips `isFullscreen=true`. `useVisibility`: dispatching a `visibilitychange` with `document.hidden=true` (stub) flips `hidden=true`.

- [ ] **Step 2: Run → FAIL. Step 3: Implement** — `useFullscreen`: listen to `document` `fullscreenchange`, compute `isFullscreen = !!document.fullscreenElement`; `request` = `ref.current?.requestFullscreen()`, `exit` = `document.exitFullscreen()`. `useVisibility`: listen to `document` `visibilitychange`, track `document.hidden`.

- [ ] **Step 4: Run → PASS. Step 5: Commit** (`feat(interview-live): fullscreen + visibility hooks`).

---

### Task 18: `useProctor` (aggregate → violations → seam)

**Files:** Create `features/interview-live/proctor/useProctor.ts`; Test `useProctor.test.tsx`.

**Interfaces:** Consumes `useFullscreen`/`useVisibility` outputs (passed in, or composed internally); on a fullscreen-exit or tab-hidden while `enabled`, emits the matching `ProctorEvent` via `session.sendProctorEvent` and calls `onViolation`; on restore/visible emits the restore events. Returns `{ violations, active }`.

- [ ] **Step 1: Failing test** — with an injected fake session (spy `sendProctorEvent`) and `enabled=true`, simulate a fullscreen exit (fire `fullscreenchange` with `fullscreenElement=null`) → assert `sendProctorEvent` called with `type:'fullscreen_exit'` and `onViolation` fired; simulate tab hidden → `type:'tab_hidden'`.

- [ ] **Step 2: Run → FAIL. Step 3: Implement** — internally use the two hooks; `useEffect` on their booleans: when it transitions to not-fullscreen (and was fullscreen) → `sendProctorEvent({type:'fullscreen_exit', at: performance.now()})` + `onViolation`; to fullscreen → `fullscreen_restored`; hidden → `tab_hidden`; visible → `tab_visible`. Guard with `enabled` and skip the initial mount. `active` = currently in a violation (not fullscreen OR hidden).

- [ ] **Step 4: Run → PASS. Step 5: Commit** (`feat(interview-live): proctor aggregation + violation events`).

---

### Task 19: `ViolationOverlay` (tamper-guarded) + wire into LiveInterview

**Files:** Create `features/interview-live/proctor/ViolationOverlay.tsx`; Modify `[sessionId]/live/_components/LiveInterview.tsx` (render overlay in `paused` state) + `LiveView.tsx` (compose `useProctor`); Test `ViolationOverlay.test.tsx`.

**Interfaces:** `ViolationOverlay` = a fixed blur overlay ("Please return to full-screen to continue" + a **Return to full-screen** button that re-requests fullscreen). A `MutationObserver` on its parent re-inserts the overlay node if removed; a removal attempt fires `session.sendProctorEvent({type:'overlay_tamper'})`. The overlay is shown by `LiveInterview` when the machine is in `paused` (driven by `useProctor` → `sendProctorEvent` → MockLiveSession echoes `pause` → provider → `PAUSE`). Work area is non-interactive under the overlay.

- [ ] **Step 1: Failing test** — render `ViolationOverlay` with a spy session + an `onReturn` spy; assert the message + button render; clicking the button calls `onReturn`; **removing the overlay DOM node re-inserts it** (append the overlay to a container, `node.remove()`, flush microtasks/`MutationObserver` via `await Promise.resolve()` + a manual observer trigger, assert the node is back and `sendProctorEvent` got `overlay_tamper`).

- [ ] **Step 2: Run → FAIL. Step 3: Implement** — a `'use client'` component: a `div` (`fixed inset-0 z-[70] backdrop-blur-md bg-background/80 grid place-items-center`) with the message + button (`onClick={onReturn}`). In a `useEffect`, attach a `MutationObserver` to `overlayRef.current?.parentElement` watching `childList`; if the overlay node is removed, re-append it and `session.sendProctorEvent({type:'overlay_tamper', at: performance.now()})`. Honest comment: deterrence only; server gating is the real guarantee. Wire in `LiveInterview`: when `state === 'paused'`, render `<ViolationOverlay onReturn={enterFullscreen}/>` above the (disabled) LiveView; compose `useProctor({ session, enabled: state==='live'||state==='paused', onViolation })` in LiveView so exits emit events.

- [ ] **Step 4: Run → PASS. Step 5: Commit** (`feat(interview-live): tamper-guarded violation overlay + proctor wiring`).

---

## Phase 5 — FE-5: Report placeholder

### Task 20: Report placeholder page

**Files:** Modify `app/(app)/interviews/[sessionId]/report/page.tsx`; Test `report/_components/ReportPlaceholder.test.tsx` (extract a small client `ReportPlaceholder` for testability).

- [ ] **Step 1: Failing test** — render `<ReportPlaceholder session={{status:'PREP_READY', ...}} />`; assert it shows "report is being prepared" and the session's company/round. (No real scorecard — sub-project E.)

- [ ] **Step 2: Run → FAIL. Step 3: Implement** — `page.tsx` (server) reads `sessionId`, renders a client `ReportPlaceholder` that uses `useSession(id)` to show `company`/round + an ended/"being prepared" message + a note that detailed scoring is coming. Keep it minimal.

- [ ] **Step 4: Run → PASS. Step 5: Commit** (`feat(interviews): report placeholder page`).

---

## Final verification

- [ ] Run the full suite: `npm run test -- --run` → all green. `npx tsc --noEmit` → clean. `npm run lint` → clean.
- [ ] Manual smoke (dev): `npm run dev` → book Start-now → (mock) prep → Join → prejoin (camera preview, T&C gate) → checks → fullscreen → live shell (code/diagram tabs, camera + avatar, controls) → exit fullscreen triggers the blur overlay + pause → return restores → End → report placeholder.
- [ ] Un-skip `tests/interview-flow.spec.ts` only if the Playwright e2e is in scope (else leave skipped; note it).

## Self-Review

**Spec coverage:** FE-1 → Tasks 7-9; FE-2 → Tasks 10-12; FE-3 → Tasks 13-16; FE-4 → Tasks 17-19; FE-5 → Task 20; the `LiveSession` seam + machine + provider → Tasks 2-6; deps/stubs → Task 1. Mock-seam, one-route lifecycle, client-deterrence + seam-emitted server gating, both trigger flows (Start-now + Schedule), Monaco+Excalidraw, report placeholder — all covered. Backend touchpoints (room/token, artifact POST, proctor POST, prepare-now) are consumed only through the seam/`MockLiveSession` (real = sub-project A). ✓

**Placeholder scan:** no TBDs; every code step has concrete code. LiveKit stub throwing is intentional (deferred). Report is intentionally a placeholder (spec decision). ✓

**Type consistency:** `LiveSession`/`ControlSignal`/`ProctorEvent`/`ArtifactSnapshot` (Task 2) used identically in Tasks 4-6, 13, 18-19; `LiveState`/`LiveEvent`/`transition` (Task 3) used in Task 6 + views; `useLiveSession()` shape consistent across the views; `sendArtifact`/`sendProctorEvent` signatures match the editors (13) and proctor (18). ✓

## Out of scope (deferred, flagged)
Real LiveKit transport + STT/LLM/TTS voice (sub-projects A/D — the seam papers over them); authoritative scorecard (E); AI's *spoken* violation reaction (control signal handled, voice needs A + a brain hook); recording/egress; mobile layout.
