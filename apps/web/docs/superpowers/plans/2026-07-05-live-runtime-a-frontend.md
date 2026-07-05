# Live Runtime (Sub-project A) — Frontend Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Wire the REAL LiveKit transport into the already-built live-interview UI: implement `LiveKitLiveSession` (via `livekit-client`), add a `reconnecting` machine state driven by `onConnectionChange`, gate the live route on real server session status (with mid-interview resume), swap the provider default off `MockLiveSession`, and add the `goLive`/`getLive` API layer (codegen from the OpenAPI contract). After this, the frontend connects to a real LiveKit room and drives the interview over a real data channel — no mock.

**Architecture:** `ChecksView` already calls `session.connect(sessionId)`. The real `LiveKitLiveSession.connect` POSTs `goLive` to get `{livekitUrl, token, roomName}`, connects a `livekit-client` `Room`, and bridges the room's **data channel** to the existing `LiveSession` seam: inbound JSON control messages → `onControl(ControlSignal)`; `sendArtifact`/`sendProctorEvent` → `publishData`; room `ConnectionStateChanged` → `onConnectionChange(ConnState)`. The AI communicates via `interviewer_utterance` text captions over the data channel. **Audio (mic publish, AI Aura TTS audio) and the candidate answer path (STT→`answer`) are sub-project D — NOT in this slice.** The provider gains a second effect subscribing `onConnectionChange` and mapping `ConnState`→machine events (new `reconnecting` state). The live route fetches `getLive` to decide prejoin vs resume vs report.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, `livekit-client ^2.20.0` (new), TanStack Query v5, vitest + @testing-library, OpenAPI codegen (`openapi-typescript`).

## Global Constraints

- **Types are codegen-only.** Never hand-write types mirroring backend DTOs. The contract `../interviewiq-infra/contracts/openapi.yaml` (sibling repo, read by `scripts/generate-types.ts`) is the source of truth; edit it and run `npm run generate:types` to regenerate `lib/api-client/generated/schema.d.ts`. `features/interview/types.ts` re-exports from the generated `components["schemas"][...]`.
- **The `LiveSession` interface (`features/interview-live/session/types.ts`) is the seam — do not change its shape** (10 members: `connect`, `disconnect`, `connectionState`, `getLocalStream`, `setMicEnabled`, `setCameraEnabled`, `sendArtifact`, `sendProctorEvent`, `onControl`, `onConnectionChange`; each `on*` returns an unsubscribe fn). `LiveKitLiveSession` implements it exactly, as a drop-in for `MockLiveSession`.
- **`ConnState` already includes `'reconnecting'`** — no type change there. The MACHINE (`machine.ts`) does NOT; you add it.
- **`ControlSignal` union is the wire contract** and matches the ai-service worker byte-for-byte. Inbound data messages (agent→candidate) map 1:1 to `ControlSignal`: `interviewer_utterance{text}`, `speaking{who,speaking}`, `pause{reason}`, `resume`, `acknowledge_violation{text?}`, `ended{reason}`. Outbound (candidate→agent): `sendArtifact` → `{type:'artifact',kind,content,language?}`; `sendProctorEvent` → `{type:'proctor',event:<ProctorEvent['type']>}`. Send `answer` is D. Do NOT rename any event string — the ai-service `_PAUSE_EVENTS` expects `ProctorEvent['type']` values verbatim (`fullscreen_exit|tab_hidden|external_display_detected|overlay_tamper` pause; `fullscreen_restored|tab_visible` resume).
- **Provider default flips** `new MockLiveSession()` → `new LiveKitLiveSession()`; `MockLiveSession` stays reachable for tests via the existing `session?` prop injection seam — do NOT delete it.
- **React 19 / eslint-plugin-react-hooks v7 gotcha (ERROR):** `react-hooks/set-state-in-effect` and `react-hooks/refs`. Hold the `Room` via **lazy `useState`** or create it inside `connect()` — never a render-read `useRef`. Dispatch machine events through the reducer `send(...)` inside subscription callbacks (the existing `onControl` effect pattern), never a raw synchronous `setState` in an effect body.
- **Client never sees the LiveKit secret** — the browser gets only `{livekitUrl, token}` from `goLive`. `livekit-client` is added to `package.json`; no LiveKit env on the client.
- **Verify the `livekit-client` API via context7** (`resolve-library-id` "livekit client js" → `query-docs`) before writing room calls. Confirmed shape (v2.20.x): `new Room(opts)`, `await room.connect(url, token)`, `room.on(RoomEvent.DataReceived, (payload:Uint8Array, participant?, kind?, topic?)=>...)`, `room.localParticipant.publishData(bytes,{reliable,topic})`, `room.on(RoomEvent.ConnectionStateChanged,(s:ConnectionState)=>...)`, `ConnectionState` enum (`Connecting|Connected|Reconnecting|SignalReconnecting|Disconnected`), `await room.disconnect()`.
- **Tests:** vitest + jsdom. `vitest.setup.ts` already stubs media APIs but NOT LiveKit — `vi.mock('livekit-client')` for `LiveKitLiveSession` tests. Provider/machine tests inject a stub via the `session?` prop (extend the existing `StubLiveSession` with an `emitConn(s)` hook for the connection bridge). Commands: `npm run test -- --run` (or `npx vitest run <file>`), `npx tsc --noEmit` (must stay clean), `npx eslint <touched files>` (project-wide lint is red from pre-existing WIP — scope to touched files). Suite is 119 green today.
- **A/D boundary — do NOT build in this slice:** mic publish to the room, AI audio-track subscribe/playback, STT, TTS, a typed/spoken answer path (`answer` messages). `getLocalStream()` returns a LOCAL `getUserMedia` stream for the self-view only (same as the mock), not a room track.

## File Structure

- `../interviewiq-infra/contracts/openapi.yaml` — **modify**: add live `SessionStatus` values + `POST/GET /interviews/sessions/{id}/live` + `GoLiveResponse` schema.
- `lib/api-client/generated/schema.d.ts` — **regenerated** (not hand-edited).
- `package.json` — **modify**: add `livekit-client`.
- `lib/constants/interview/index.ts` — **modify**: add `live` endpoint + query key.
- `features/interview/api.ts` — **modify**: add `goLive`, `getLive`.
- `features/interview/hooks.ts` — **modify**: add a `useLiveState` GET hook (name avoids the provider's `useLiveSession`).
- `features/interview/types.ts` — **modify**: re-export `GoLiveResponse`.
- `features/interview-live/session/machine.ts` — **modify**: add `reconnecting` state + `RECONNECTING`/`RECONNECTED` events + transitions.
- `features/interview-live/session/LiveKitLiveSession.ts` — **replace** the stub with the real impl.
- `features/interview-live/session/LiveSessionProvider.tsx` — **modify**: add `onConnectionChange` effect (ConnState→events) + flip default to `LiveKitLiveSession`.
- `app/(app)/interviews/[sessionId]/live/_components/LiveInterview.tsx` — **modify**: add a `reconnecting` view case + server-status gating/resume.
- Tests alongside each.

---

### Task 1: OpenAPI contract + codegen + api layer + dependency

**Files:**
- Modify: `../interviewiq-infra/contracts/openapi.yaml`
- Regenerate: `lib/api-client/generated/schema.d.ts` (via `npm run generate:types`)
- Modify: `package.json` (+ install `livekit-client`)
- Modify: `lib/constants/interview/index.ts`, `features/interview/api.ts`, `features/interview/hooks.ts`, `features/interview/types.ts`
- Test: `features/interview/live-api.test.ts`

**Interfaces:**
- Produces: `GoLiveResponse` type (`{ livekitUrl: string | null, token: string | null, roomName: string | null, status: SessionStatus }`); `SessionStatus` now includes `LIVE_IN_PROGRESS|COMPLETED|ABORTED_TECHNICAL`; `INTERVIEW_ENDPOINTS.live(id)`, `INTERVIEW_QUERY_KEYS.live(id)`; `goLive(id): Promise<GoLiveResponse>`, `getLive(id): Promise<GoLiveResponse>`; `useLiveState(id)` query hook.

- [ ] **Step 1: Update the OpenAPI contract**

In `../interviewiq-infra/contracts/openapi.yaml` (read its structure first — match the existing `SessionStatus` enum + the `/interviews/sessions/{sessionId}` path style):
  - Add `LIVE_IN_PROGRESS`, `COMPLETED`, `ABORTED_TECHNICAL` to the `SessionStatus` enum.
  - Add a `GoLiveResponse` schema under `components.schemas`:
    ```yaml
    GoLiveResponse:
      type: object
      properties:
        livekitUrl: { type: string, nullable: true }
        token: { type: string, nullable: true }
        roomName: { type: string, nullable: true }
        status: { $ref: '#/components/schemas/SessionStatus' }
      required: [status]
    ```
  - Add two operations (match the existing security + parameter style of `/interviews/sessions/{sessionId}`):
    ```yaml
    /api/v1/interviews/sessions/{sessionId}/live:
      post:
        summary: Start (or resume) the live interview; mints a LiveKit join token
        parameters: [ { $ref: '#/components/parameters/SessionId' } ]   # or inline, matching existing style
        responses:
          '200': { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/GoLiveResponse' } } } }
      get:
        summary: Current live state (fresh token if LIVE_IN_PROGRESS)
        parameters: [ { $ref: '#/components/parameters/SessionId' } ]
        responses:
          '200': { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/GoLiveResponse' } } } }
    ```
    (Use whatever the file's convention is for the `sessionId` path param and auth — copy from the sibling GET session op.)

- [ ] **Step 2: Regenerate + add the dependency**

```bash
npm install livekit-client@^2.20.0
npm run generate:types
```
Verify `lib/api-client/generated/schema.d.ts` now has the three live `SessionStatus` values + a `GoLiveResponse` schema + the two `live` operations. (If `generate:types` can't find the contract, confirm the sibling path `../interviewiq-infra/contracts/openapi.yaml` exists.)

- [ ] **Step 3: Write the failing api-layer test**

`features/interview/live-api.test.ts`:
```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { goLive, getLive } from "./api";
import * as client from "@/lib/api-client/client";
import { INTERVIEW_ENDPOINTS } from "@/lib/constants/interview";

describe("live api", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("goLive POSTs to the live endpoint", async () => {
    const spy = vi.spyOn(client, "apiFetch").mockResolvedValue({
      livekitUrl: "wss://x", token: "jwt", roomName: "interview-s1", status: "LIVE_IN_PROGRESS",
    } as never);
    const res = await goLive("s1");
    expect(spy).toHaveBeenCalledWith(INTERVIEW_ENDPOINTS.live("s1"), { method: "POST" });
    expect(res.token).toBe("jwt");
  });

  it("getLive GETs the live endpoint", async () => {
    const spy = vi.spyOn(client, "apiFetch").mockResolvedValue({
      livekitUrl: null, token: null, roomName: null, status: "PREP_READY",
    } as never);
    const res = await getLive("s1");
    expect(spy).toHaveBeenCalledWith(INTERVIEW_ENDPOINTS.live("s1"));
    expect(res.status).toBe("PREP_READY");
  });
});
```

- [ ] **Step 4: Run it to verify it fails** — `npx vitest run features/interview/live-api.test.ts` → FAIL (`goLive`/`getLive`/`live` endpoint don't exist).

- [ ] **Step 5: Implement the api layer**

In `lib/constants/interview/index.ts` add to `INTERVIEW_ENDPOINTS`: `live: (id: string) => \`${SESSIONS}/${id}/live\`,` and to `INTERVIEW_QUERY_KEYS`: `live: (id: string) => ["interviews", "session", id, "live"] as const,`.
In `features/interview/types.ts` add: `export type GoLiveResponse = components["schemas"]["GoLiveResponse"];`.
In `features/interview/api.ts` add:
```ts
export function goLive(id: string): Promise<GoLiveResponse> {
  return apiFetch<GoLiveResponse>(INTERVIEW_ENDPOINTS.live(id), { method: "POST" });
}
export function getLive(id: string): Promise<GoLiveResponse> {
  return apiFetch<GoLiveResponse>(INTERVIEW_ENDPOINTS.live(id));
}
```
(import `GoLiveResponse` from `./types`.)
In `features/interview/hooks.ts` add a GET hook (mirror `useSession`, but no polling):
```ts
export function useLiveState(id: string) {
  return useQuery({
    queryKey: INTERVIEW_QUERY_KEYS.live(id),
    queryFn: () => getLive(id),
  });
}
```
(import `getLive`.)

- [ ] **Step 6: Run tests + typecheck** — `npx vitest run features/interview/live-api.test.ts` PASS; `npx tsc --noEmit` clean (proves the generated `GoLiveResponse`/`SessionStatus` types resolve).

- [ ] **Step 7: Commit**
```bash
git add ../interviewiq-infra/contracts/openapi.yaml lib/api-client/generated/schema.d.ts package.json package-lock.json \
        lib/constants/interview/index.ts features/interview/api.ts features/interview/hooks.ts features/interview/types.ts \
        features/interview/live-api.test.ts
git commit -m "feat(live): go-live/get-live api + contract codegen + livekit-client dep"
```
(NOTE: the contract file lives in a non-git sibling dir; `git add` of `../interviewiq-infra/...` will be ignored by this repo's git — that's fine, commit the frontend files; mention the contract edit in the commit body.)

---

### Task 2: Machine — `reconnecting` state

**Files:**
- Modify: `features/interview-live/session/machine.ts`
- Test: `features/interview-live/session/machine.reconnecting.test.ts`

**Interfaces:**
- Produces: `LiveState` gains `'reconnecting'`; `LiveEvent` gains `{ type: 'RECONNECTING' }` and `{ type: 'RECONNECTED' }`; transitions `live|paused → reconnecting` (on `RECONNECTING`) and `reconnecting → live` (on `RECONNECTED`), plus `reconnecting` handles `ENDED`/`END` (→ ending/ended) and `ERROR`.

- [ ] **Step 1: Write the failing test**

`features/interview-live/session/machine.reconnecting.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { initialMachine, transition, type LiveState } from "./machine";

function at(state: LiveState) {
  return { state, ctx: initialMachine().ctx };
}

describe("machine reconnecting", () => {
  it("live -> reconnecting -> live", () => {
    const r1 = transition("live", at("live").ctx, { type: "RECONNECTING" });
    expect(r1.state).toBe("reconnecting");
    const r2 = transition("reconnecting", r1.ctx, { type: "RECONNECTED" });
    expect(r2.state).toBe("live");
  });

  it("paused -> reconnecting preserves nothing illegal, and RECONNECTED returns to live", () => {
    const paused = transition("live", at("live").ctx, { type: "PAUSE", reason: "tab_hidden" });
    const rc = transition("paused", paused.ctx, { type: "RECONNECTING" });
    expect(rc.state).toBe("reconnecting");
    expect(transition("reconnecting", rc.ctx, { type: "RECONNECTED" }).state).toBe("live");
  });

  it("reconnecting -> ended on ENDED", () => {
    const rc = transition("live", at("live").ctx, { type: "RECONNECTING" });
    const ended = transition("reconnecting", rc.ctx, { type: "ENDED", reason: "aborted_technical" });
    expect(ended.state).toBe("ended");
    expect(ended.ctx.endedReason).toBe("aborted_technical");
  });

  it("reconnecting -> error on ERROR", () => {
    const rc = transition("live", at("live").ctx, { type: "RECONNECTING" });
    expect(transition("reconnecting", rc.ctx, { type: "ERROR" }).state).toBe("error");
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `npx vitest run features/interview-live/session/machine.reconnecting.test.ts` → FAIL.

- [ ] **Step 3: Implement**

In `machine.ts`: add `'reconnecting'` to `LiveState`; add `| { type: 'RECONNECTING' } | { type: 'RECONNECTED' }` to `LiveEvent`; in `transition`, add to the `live` and `paused` cases: `if (event.type === 'RECONNECTING') return { state: 'reconnecting', ctx }`; add a new case:
```ts
    case 'reconnecting':
      if (event.type === 'RECONNECTED') return { state: 'live', ctx };
      if (event.type === 'ENDED') return { state: 'ended', ctx: { ...ctx, endedReason: event.reason ?? ctx.endedReason ?? 'completed' } };
      if (event.type === 'END') return { state: 'ending', ctx };
      break;
```
(`ERROR` is already globally handled at the top of `transition`.)

- [ ] **Step 4: Run to verify pass** — `npx vitest run features/interview-live/session/machine.reconnecting.test.ts` PASS; also run the existing `machine.test.ts` to confirm no regression.

- [ ] **Step 5: Commit**
```bash
git add features/interview-live/session/machine.ts features/interview-live/session/machine.reconnecting.test.ts
git commit -m "feat(live): add reconnecting machine state + RECONNECTING/RECONNECTED events"
```

---

### Task 3: Real `LiveKitLiveSession`

**Files:**
- Replace: `features/interview-live/session/LiveKitLiveSession.ts`
- Test: `features/interview-live/session/LiveKitLiveSession.test.ts`

**Interfaces:**
- Consumes: `LiveSession`/`ConnState`/`ControlSignal`/`ProctorEvent`/`ArtifactSnapshot` (`./types`), `goLive` (`@/features/interview/api`), `livekit-client` (`Room`, `RoomEvent`, `ConnectionState`).
- Produces: `class LiveKitLiveSession implements LiveSession` — a drop-in for `MockLiveSession`.

**Design (implement exactly):**
- Callback registries `Set<(c)=>void>` for control + `Set<(s)=>void>` for conn; `connectionState: ConnState = 'idle'`; a local self-view `MediaStream | null`; the `Room` held privately (created in `connect`).
- `connect(sessionId)`: set `connectionState='connecting'` + notify; `const { livekitUrl, token } = await goLive(sessionId)`; if missing url/token → throw (ChecksView maps to ERROR); create `new Room()`; register `room.on(RoomEvent.DataReceived, ...)` → decode `JSON.parse(new TextDecoder().decode(payload))` and if it's a valid `ControlSignal` shape, emit to control cbs (guard with try/catch — ignore malformed); register `room.on(RoomEvent.ConnectionStateChanged, (s) => this.setConn(mapConnState(s)))`; `await room.connect(livekitUrl, token)`; acquire the local self-view stream via `navigator.mediaDevices.getUserMedia({audio:true,video:true})` (best-effort, for the camera tile — NOT published; catch→null); set `connectionState='connected'` + notify. On any failure, set `'disconnected'`/rethrow appropriately.
- `mapConnState(s: ConnectionState): ConnState`: `Connecting→'connecting'`, `Connected→'connected'`, `Reconnecting|SignalReconnecting→'reconnecting'`, `Disconnected→'disconnected'`.
- `disconnect()`: stop the local stream tracks; `await room?.disconnect()`; set `'disconnected'`.
- `getLocalStream()`: return the local self-view stream. `setMicEnabled/setCameraEnabled`: toggle the local stream's audio/video track `.enabled` (self-view only; room mic publish is D).
- `sendArtifact(a)`: `this.publish({ type: 'artifact', kind: a.kind, content: a.content, language: a.language })`. `sendProctorEvent(e)`: `this.publish({ type: 'proctor', event: e.type })`. `publish(obj)`: `room?.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(obj)), { reliable: true })` (fire-and-forget; guard if no room).
- `onControl`/`onConnectionChange`: add to the set, return an unsubscribe closure. `setConn(s)`: set field + notify conn cbs.

- [ ] **Step 1: Write the failing test** (mock `livekit-client`)

`features/interview-live/session/LiveKitLiveSession.test.ts`:
```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

// a controllable fake Room
const handlers: Record<string, (...a: unknown[]) => void> = {};
const publishData = vi.fn();
const connect = vi.fn(async () => {});
const disconnect = vi.fn(async () => {});
vi.mock("livekit-client", () => ({
  Room: class {
    localParticipant = { publishData };
    on(event: string, cb: (...a: unknown[]) => void) { handlers[event] = cb; return this; }
    connect = connect;
    disconnect = disconnect;
  },
  RoomEvent: { DataReceived: "dataReceived", ConnectionStateChanged: "connectionStateChanged" },
  ConnectionState: { Connecting: "connecting", Connected: "connected", Reconnecting: "reconnecting", SignalReconnecting: "signalReconnecting", Disconnected: "disconnected" },
}));
vi.mock("@/features/interview/api", () => ({
  goLive: vi.fn(async () => ({ livekitUrl: "wss://x", token: "jwt", roomName: "interview-s1", status: "LIVE_IN_PROGRESS" })),
}));

import { LiveKitLiveSession } from "./LiveKitLiveSession";
import { goLive } from "@/features/interview/api";

describe("LiveKitLiveSession", () => {
  beforeEach(() => { for (const k in handlers) delete handlers[k]; vi.clearAllMocks(); });

  it("connect fetches a token, connects the room, and reports connected", async () => {
    const s = new LiveKitLiveSession();
    const seen: string[] = [];
    s.onConnectionChange((st) => seen.push(st));
    await s.connect("s1");
    expect(goLive).toHaveBeenCalledWith("s1");
    expect(connect).toHaveBeenCalledWith("wss://x", "jwt");
    expect(s.connectionState).toBe("connected");
    expect(seen).toContain("connecting");
    expect(seen).toContain("connected");
  });

  it("maps inbound data messages to onControl", async () => {
    const s = new LiveKitLiveSession();
    const got: unknown[] = [];
    s.onControl((c) => got.push(c));
    await s.connect("s1");
    const payload = new TextEncoder().encode(JSON.stringify({ type: "interviewer_utterance", text: "hi" }));
    handlers["dataReceived"](payload);
    expect(got).toContainEqual({ type: "interviewer_utterance", text: "hi" });
  });

  it("maps ConnectionStateChanged(reconnecting) to onConnectionChange", async () => {
    const s = new LiveKitLiveSession();
    const seen: string[] = [];
    await s.connect("s1");
    s.onConnectionChange((st) => seen.push(st));
    handlers["connectionStateChanged"]("reconnecting");
    expect(seen).toContain("reconnecting");
  });

  it("sendProctorEvent publishes a proctor message", async () => {
    const s = new LiveKitLiveSession();
    await s.connect("s1");
    s.sendProctorEvent({ type: "fullscreen_exit", at: 1 });
    const sent = JSON.parse(new TextDecoder().decode(publishData.mock.calls[0][0] as Uint8Array));
    expect(sent).toEqual({ type: "proctor", event: "fullscreen_exit" });
  });

  it("malformed inbound data does not throw", async () => {
    const s = new LiveKitLiveSession();
    await s.connect("s1");
    expect(() => handlers["dataReceived"](new TextEncoder().encode("not json"))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run features/interview-live/session/LiveKitLiveSession.test.ts` → FAIL (stub throws).

- [ ] **Step 3: Implement** the class per the Design. Verify the real `livekit-client` `RoomEvent`/`ConnectionState`/`publishData` names via context7 and match them; the test mock mirrors the confirmed v2.20 names. Guard the `DataReceived` decode in try/catch. Only emit a `ControlSignal` if `typeof parsed==='object' && parsed && typeof parsed.type==='string'`.

- [ ] **Step 4: Run to verify pass** — `npx vitest run features/interview-live/session/LiveKitLiveSession.test.ts` PASS (5); `npx tsc --noEmit` clean; `npx eslint features/interview-live/session/LiveKitLiveSession.ts` clean.

- [ ] **Step 5: Commit**
```bash
git add features/interview-live/session/LiveKitLiveSession.ts features/interview-live/session/LiveKitLiveSession.test.ts
git commit -m "feat(live): real LiveKitLiveSession — room connect, data-channel control bridge"
```

---

### Task 4: Provider — connection bridge + swap default

**Files:**
- Modify: `features/interview-live/session/LiveSessionProvider.tsx`
- Test: `features/interview-live/session/LiveSessionProvider.reconnect.test.tsx`

**Interfaces:**
- Consumes: `LiveKitLiveSession` (Task 3), the machine's `RECONNECTING`/`RECONNECTED` events (Task 2), `LiveSession.onConnectionChange`.
- Produces: the provider subscribes `onConnectionChange` and maps `ConnState`→machine events; default session is `new LiveKitLiveSession()`.

- [ ] **Step 1: Write the failing test** (extend the stub pattern with `emitConn`)

`features/interview-live/session/LiveSessionProvider.reconnect.test.tsx`:
```tsx
import { describe, expect, it, act } from "vitest";
import { render } from "@testing-library/react";
import { useEffect } from "react";
import type { ConnState, ControlSignal, LiveSession } from "./types";
import { LiveSessionProvider, useLiveSession } from "./LiveSessionProvider";

class StubLiveSession implements LiveSession {
  connectionState: ConnState = "connected";
  private cc = new Set<(s: ConnState) => void>();
  emitConn(s: ConnState) { this.connectionState = s; this.cc.forEach((cb) => cb(s)); }
  async connect() {} async disconnect() {}
  getLocalStream() { return null; } setMicEnabled() {} setCameraEnabled() {}
  sendArtifact() {} sendProctorEvent() {}
  onControl(_cb: (c: ControlSignal) => void) { return () => {}; }
  onConnectionChange(cb: (s: ConnState) => void) { this.cc.add(cb); return () => this.cc.delete(cb); }
}

function Probe({ onState }: { onState: (s: string) => void }) {
  const { state, send } = useLiveSession();
  useEffect(() => { onState(state); });
  // drive to live so RECONNECTING is a legal transition
  useEffect(() => { send({ type: "START_CHECKS" }); send({ type: "CHECKS_PASSED" }); send({ type: "CONNECTED" }); }, [send]);
  return null;
}

describe("provider connection bridge", () => {
  it("reconnecting ConnState drives the machine to reconnecting and back", () => {
    const session = new StubLiveSession();
    const states: string[] = [];
    render(
      <LiveSessionProvider sessionId="s1" session={session}>
        <Probe onState={(s) => states.push(s)} />
      </LiveSessionProvider>,
    );
    act(() => session.emitConn("reconnecting"));
    expect(states).toContain("reconnecting");
    act(() => session.emitConn("connected"));
    expect(states.at(-1)).toBe("live");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (no bridge; stays `live`).

- [ ] **Step 3: Implement** — in `LiveSessionProvider.tsx` add a second effect (mirroring the `onControl` one) after it:
```tsx
  useEffect(() => {
    const off = liveSession.onConnectionChange((s) => {
      if (s === 'reconnecting') send({ type: 'RECONNECTING' })
      else if (s === 'connected') send({ type: 'RECONNECTED' })
      else if (s === 'disconnected') send({ type: 'ENDED', reason: 'aborted_technical' })
    })
    return off
  }, [liveSession])
```
And flip the default: `useState<LiveSession>(() => session ?? new LiveKitLiveSession())` (import `LiveKitLiveSession`; remove the `MockLiveSession` default import if now unused — keep the file importing nothing dead).
NOTE: `RECONNECTED`→`live` only fires from the `reconnecting` state (machine no-ops it elsewhere), and `disconnected` mapping to `ENDED` is safe because `ENDED` is handled from live/paused/reconnecting; a `disconnected` during normal teardown is harmless (already ending/ended → no-op).

- [ ] **Step 4: Run to verify pass** — the new test PASS; run the existing `LiveSessionProvider.test.tsx` + `LiveInterview*.test.tsx` to confirm the default swap + new effect didn't break them (they inject their own session, so the default swap shouldn't affect them; if any test relied on the Mock default, fix by passing an explicit session). `npx tsc --noEmit` clean; `npx eslint` on the file clean (watch `set-state-in-effect` — the effect only calls `send`, which is a reducer dispatch, so it's fine).

- [ ] **Step 5: Commit**
```bash
git add features/interview-live/session/LiveSessionProvider.tsx features/interview-live/session/LiveSessionProvider.reconnect.test.tsx
git commit -m "feat(live): wire onConnectionChange -> machine + default to LiveKitLiveSession"
```

---

### Task 5: Live-route server-status gating + resume

**Files:**
- Modify: `app/(app)/interviews/[sessionId]/live/_components/LiveInterview.tsx`
- Test: `app/(app)/interviews/[sessionId]/live/_components/LiveInterview.gating.test.tsx`

**Interfaces:**
- Consumes: `useLiveState(id)` (Task 1), the machine (`reconnecting`), `LiveInterviewInner`'s view switch.
- Produces: the live route only enters prejoin when the session is `PREP_READY`; if `LIVE_IN_PROGRESS`, it resumes; terminal statuses route to the report; a `reconnecting` view case renders a "Reconnecting…" affordance (not the bare `{state}…` placeholder).

- [ ] **Step 1: Write the failing test**

`app/(app)/interviews/[sessionId]/live/_components/LiveInterview.gating.test.tsx` (mock `useLiveState` + `next/navigation`):
```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const useLiveState = vi.fn();
vi.mock("@/features/interview/hooks", () => ({ useLiveState: (id: string) => useLiveState(id) }));
// keep the provider real but with an injected inert session
import type { LiveSession } from "@/features/interview-live/session/types";
const inert: Partial<LiveSession> = {
  connectionState: "idle", getLocalStream: () => null, setMicEnabled() {}, setCameraEnabled() {},
  sendArtifact() {}, sendProctorEvent() {}, onControl: () => () => {}, onConnectionChange: () => () => {},
  connect: async () => {}, disconnect: async () => {},
};

import LiveInterview from "./LiveInterview";

describe("live route gating", () => {
  it("routes to the report for a COMPLETED session", () => {
    useLiveState.mockReturnValue({ data: { status: "COMPLETED" }, isLoading: false });
    render(<LiveInterview sessionId="s1" session={inert as LiveSession} />);
    expect(push).toHaveBeenCalledWith("/interviews/s1/report");
  });

  it("shows prejoin for a PREP_READY session", () => {
    useLiveState.mockReturnValue({ data: { status: "PREP_READY" }, isLoading: false });
    render(<LiveInterview sessionId="s1" session={inert as LiveSession} />);
    expect(screen.queryByText(/report/i)).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — FAIL (no gating).

- [ ] **Step 3: Implement** — in `LiveInterview.tsx`, before/around the provider mount, call `useLiveState(sessionId)`; while `isLoading` render a spinner; if `data.status` is `COMPLETED`/`ABORTED_TECHNICAL` → `useEffect(() => router.push(\`/interviews/${sessionId}/report\`), [])`-style redirect (dispatch the push in an effect, not during render, to satisfy React + eslint); if `PREP_READY` → render the provider at `prejoin` (current behavior); if `LIVE_IN_PROGRESS` → render the provider and drive it to resume (e.g. an initial `RESUME`-to-live path — the simplest MVP: mount and let `ChecksView`/connect re-run; a full transcript resume is out of scope, documented). Add a `reconnecting` case to `LiveInterviewInner`'s switch rendering a centered "Reconnecting…" overlay (reuse the existing placeholder styling but with real copy). Keep the gating hook usage SSR-safe and dispatch redirects in effects.
NOTE: `LiveInterview.tsx` currently takes `{ sessionId, session? }`. Keep the `session?` injection for tests. The gating wraps the existing provider mount.

- [ ] **Step 4: Run to verify pass** — the gating test PASS; run existing `LiveInterview.test.tsx`/`LiveInterview.error.test.tsx`/`LiveInterview.remount.test.tsx` (they inject a session; ensure the added `useLiveState` is mocked or defaults gracefully — if those tests don't mock it, provide a safe default in the component when `data` is undefined, e.g. treat undefined as "still loading" so they render as before, OR update those tests to mock `useLiveState` returning `PREP_READY`). `npx tsc --noEmit` + `npx eslint` on touched files clean.

- [ ] **Step 5: Commit**
```bash
git add "app/(app)/interviews/[sessionId]/live/_components/LiveInterview.tsx" "app/(app)/interviews/[sessionId]/live/_components/LiveInterview.gating.test.tsx"
git commit -m "feat(live): gate live route on server status + resume + reconnecting view"
```

---

## Self-Review

**Spec coverage (A design §5.3):**
- Real `LiveKitLiveSession` (connect/token/room/data channel) → Task 3 ✅
- `onConnectionChange` wiring + `reconnecting` machine state → Tasks 2 + 4 ✅
- Provider default off the mock → Task 4 ✅
- Live-route server-status gating + refresh-resume → Task 5 ✅
- go-live/get-live API (codegen) → Task 1 ✅
- Report shows real `ended_reason` → the backend persists it (backend slice, merged); the report page reads `GET /sessions/{id}` — already wired; no new frontend work needed beyond the status now existing in codegen (Task 1). If the ReportPlaceholder needs the value surfaced, that is a trivial follow-up, NOT this slice.

**Deferred to D (explicitly NOT here):** mic publish to the room, AI Aura audio-track subscribe + playback (+ `room.startAudio()` on the Enter gesture), STT, TTS, the candidate answer path (`answer` messages / `sendAnswer`). A's AI communicates via `interviewer_utterance` captions; D makes it spoken and two-way.

**Type consistency:** `GoLiveResponse` shape identical across contract/api/test; `ControlSignal`/`ProctorEvent` unchanged (wire contract with the ai-service, incl. `external_display_detected`); machine events `RECONNECTING`/`RECONNECTED` consistent across machine + provider.

**Placeholder scan:** `livekit-client` `RoomEvent`/`ConnectionState`/`publishData` names carry a context7-verify instruction (external, version-sensitive); every our-side logic block is complete. Contract-file `git add` caveat noted (sibling non-git dir).

**Known adaptation risks:** (1) existing `LiveInterview*`/`LiveSessionProvider` tests may need `useLiveState` mocked or the default-session swap accounted for — handle per Task 4/5 notes (prefer safe-default over broad test rewrites). (2) `generate:types` requires the sibling contract path to resolve; if the infra dir moved, locate `openapi.yaml` via `scripts/generate-types.ts`. (3) LiveKit `getLocalStream` doesn't map 1:1 to a room track — A returns a local `getUserMedia` self-view (not published), matching the mock; the room-published mic is D.
