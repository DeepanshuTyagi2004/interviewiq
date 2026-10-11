# Warm Interviewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The interviewer is already in the room, loaded and listening, when the candidate presses **Enter interview**, so the wait before its first words is one reply instead of a whole start-up.

**Architecture:** The instructions page makes one best-effort `POST …/live/warm`; the API dispatches the interviewer without touching session state. The worker loads everything and starts its voice session, then holds the 45-minute clock and the greeting until the browser's first `workspace.hello`. `startLive` reuses a waiting interviewer and only dispatches when none exists, so a failed warm-up behaves exactly like today.

**Tech Stack:** Express 5 / TypeScript / Vitest (API); Python 3.12 / LiveKit Agents 1.8.5 / pytest (worker); Next.js 16 / React 19 / Vitest (web); OpenAPI codegen (`pnpm contracts:types`).

**Spec:** `docs/superpowers/specs/2026-10-11-warm-interviewer-design.md` (approved 2026-10-11). Read it first. One mechanism differs from it on purpose: when the blueprint was re-prepared while the interviewer waited, the worker **leaves and lets the existing re-dispatch bring a fresh one** instead of reloading in place (a re-prepared blueprint can change the interviewer's persona and so the voice's gender, which cannot be swapped on a running voice session). Task 6 updates the spec to say so.

## Global Constraints

- **Standing rule (user):** never run vitest, tsc, eslint or pytest unless the user explicitly asks. Steps marked **(only if the user asks)** are skipped otherwise, and the final report says the tests were written but not run. Verify with the ad-hoc scripts and the manual join instead.
- **No commits** (user rule): leave all work in the working tree; the user commits.
- **Concurrent editors:** before editing a file run `git status --short <file>`; if it shows changes you did not make, stop and ask. Before editing any `apps/ai-service/**/*.py`, confirm no blueprint prep is in flight (Task 4, Step 1).
- Every mock round stays **45 minutes** (`MOCK_ROUND_MINUTES`); nothing here changes its length.
- The round (45-minute clock and greeting) **starts when the candidate arrives, not when the interviewer does**.
- A waiting interviewer leaves after **15 minutes** with no candidate; one dispatch per session within **30 s** (`REDISPATCH_AFTER_MS`).
- Warm-up is only for accounts the live interviewer is available to, and **changes nothing but the dispatch**: no status change, no "seen" problems, no clock.
- Entering the room still goes live and dispatches when nobody is there; warm-up is only ever an optimisation.
- Never hand-write types that mirror API DTOs: change `packages/contracts/openapi.yaml`, then run `pnpm contracts:types`.
- API errors keep the `{ code, message }` envelope; new endpoints live under `/api/v1/…`.
- Match surrounding style: the API and web use double quotes in `.ts`/`.tsx` under `app/`, `lib/` and `routes/`, and single quotes without semicolons in `apps/web/features/interview-live/**`; the worker keeps its comment density and `from __future__ import annotations`.

## Review Focus

Failure modes the spec implies but no happy-path test would catch, most likely first. Each has a test in the task named in brackets.

1. **Double mount / refresh of the instructions page** fires two warm-ups at once: exactly one `CreateDispatch`. [Task 2 concurrent test, Task 5 once-per-mount test]
2. **A finished interview re-dispatched** (its end never reached the API) must never greet again: `begin()` is not released and the worker repeats the ending. [Task 4 `ended` test]
3. **Browser messages sent between its hello and the round starting** (a proctor event, code snapshot) must not be lost or reordered. [Task 4 held-messages test]
4. **No candidate ever comes:** the worker leaves after 15 minutes, deletes the room, and the session stays `PREP_READY`. [Task 4 `nobody` test]
5. **The presence check or the dispatch itself fails at LiveKit:** warm-up answers `warming: false` without an error, and go-live still dispatches. [Task 2 failure tests]
6. **The interviewer never arrives:** the page enters the room anyway after 15 s instead of spinning forever. [Task 5 timeout test]

---

### Task 1: LiveKit spike and `hasDispatch`

**Files:**
- Create: `apps/api/scripts/dev/spike-livekit-dispatch.ts` (throwaway; deleted in Task 6)
- Modify: `apps/api/src/integrations/livekit.ts`
- Test: `apps/api/test/integrations/liveKitRoomAdmin.test.ts`

**Interfaces:**
- Produces: `AgentRooms.hasDispatch(sessionId: string): Promise<boolean>` and `LiveKitRoomAdmin.hasDispatch` — true when `interview-{sessionId}` has a dispatch for the interviewer agent that has not finished (no job yet, or a job still pending or running); false for a missing room (HTTP 404); rejects on other upstream errors.

- [ ] **Step 1: Write the spike script**

```ts
/**
 * THROWAWAY spike (spec 2026-10-11 §7): what does LiveKit report for a dispatch whose job has not started, and what
 * happens to a room that only has a dispatch?
 *
 *   pnpm exec tsx --env-file=.env scripts/dev/spike-livekit-dispatch.ts
 *
 * Uses an agent name no worker registers, in a room named spike-<time>, and deletes the room at the end.
 */
import { AccessToken } from "livekit-server-sdk";

const url = (process.env.LIVEKIT_URL ?? "").replace(/^ws(s?):\/\//, "http$1://").replace(/\/+$/, "");
const key = process.env.LIVEKIT_API_KEY ?? "";
const secret = process.env.LIVEKIT_API_SECRET ?? "";
if (!url || !key || !secret) throw new Error("set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET");
const room = `spike-${Date.now()}`;

async function call(service: string, method: string, body: Record<string, unknown>) {
  const token = new AccessToken(key, secret, { ttl: 120 });
  token.addGrant({ roomAdmin: true, roomList: true, roomCreate: true, room });
  const res = await fetch(`${url}/twirp/livekit.${service}/${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token.toJwt()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

console.log("list before any dispatch:", JSON.stringify(await call("AgentDispatchService", "ListDispatch", { room })));
console.log("create:", JSON.stringify(await call("AgentDispatchService", "CreateDispatch", { room, agent_name: "spike-nobody", metadata: "{}" })));
console.log("list after:", JSON.stringify(await call("AgentDispatchService", "ListDispatch", { room })));
console.log("participants:", JSON.stringify(await call("RoomService", "ListParticipants", { room })));
console.log("rooms:", JSON.stringify(await call("RoomService", "ListRooms", { names: [room] })));
console.log("delete room:", JSON.stringify(await call("RoomService", "DeleteRoom", { room })));
```

- [ ] **Step 2: Run the spike against the real LiveKit project and record what it shows**

Run: `cd apps/api && pnpm exec tsx --env-file=.env scripts/dev/spike-livekit-dispatch.ts`
Expected: six lines. Write down, for Task 6 (spec §10): (a) whether the list key is `agent_dispatches` or `agentDispatches`; (b) whether the dispatch appears with an empty `jobs` list before any worker takes it; (c) whether `rooms` shows the room after the dispatch alone, and its `empty_timeout`. The implementation in Step 4 accepts both key spellings and treats "no jobs yet" as unfinished, so it is correct whichever way (a) and (b) come out; if (b) shows the dispatch missing, `hasDispatch` simply never helps during the boot window and the 30 s in-process guard and the worker's own "another interviewer is here" guard cover it.

- [ ] **Step 3: Write the failing tests** (append inside `describe("LiveKitRoomAdmin", …)` in `liveKitRoomAdmin.test.ts`)

```ts
  describe("hasDispatch", () => {
    const admin = (answer: unknown) =>
      new LiveKitRoomAdmin("wss://x.livekit.cloud", "APIkey", SECRET, new FakeFetch().on("POST", /ListDispatch$/, answer).fetch);
    const dispatch = (jobs: unknown[], extra: Record<string, unknown> = {}) => ({
      agent_dispatches: [{ id: "AD_1", agent_name: "interviewer", room: `interview-${SID}`, state: { jobs }, ...extra }],
    });

    it("is true for a dispatch whose job has not started, or is still pending or running", async () => {
      expect(await admin(dispatch([])).hasDispatch(SID)).toBe(true);
      expect(await admin(dispatch([{ state: { status: "JS_PENDING" } }])).hasDispatch(SID)).toBe(true);
      expect(await admin(dispatch([{ state: { status: "JS_RUNNING" } }])).hasDispatch(SID)).toBe(true);
      expect(await admin(dispatch([{ state: { status: 1 } }])).hasDispatch(SID)).toBe(true);
    });

    it("is false once the job finished, the dispatch was deleted, or it belongs to another agent", async () => {
      expect(await admin(dispatch([{ state: { status: "JS_SUCCESS" } }])).hasDispatch(SID)).toBe(false);
      expect(await admin(dispatch([{ state: { status: "JS_FAILED" } }])).hasDispatch(SID)).toBe(false);
      expect(await admin(dispatch([{ state: { status: 2 } }])).hasDispatch(SID)).toBe(false);
      expect(await admin(dispatch([], { deleted_at: "1760000000" })).hasDispatch(SID)).toBe(false);
      expect(await admin(dispatch([], { agent_name: "someone-else" })).hasDispatch(SID)).toBe(false);
      expect(await admin({ agent_dispatches: [] }).hasDispatch(SID)).toBe(false);
      expect(await admin({}).hasDispatch(SID)).toBe(false);
    });

    it("reads camelCase keys too", async () => {
      const camel = { agentDispatches: [{ id: "AD_1", agentName: "interviewer", state: { jobs: [] } }] };
      expect(await admin(camel).hasDispatch(SID)).toBe(true);
    });

    it("treats a room that does not exist as having no dispatch, but still fails on real errors", async () => {
      const missing = new FakeFetch().on("POST", /ListDispatch$/, () => json({ code: "not_found", msg: "requested room does not exist" }, 404));
      expect(await new LiveKitRoomAdmin("wss://x.livekit.cloud", "APIkey", SECRET, missing.fetch).hasDispatch(SID)).toBe(false);
      const broken = new FakeFetch().on("POST", /ListDispatch$/, () => json({ code: "internal" }, 500));
      await expect(new LiveKitRoomAdmin("wss://x.livekit.cloud", "APIkey", SECRET, broken.fetch).hasDispatch(SID)).rejects.toThrow();
    });
  });
```

- [ ] **Step 4: Run the tests to see them fail (only if the user asks)**

Run: `cd apps/api && pnpm exec vitest run test/integrations/liveKitRoomAdmin.test.ts`
Expected: FAIL — `hasDispatch is not a function`.

- [ ] **Step 5: Implement** — in `apps/api/src/integrations/livekit.ts`

Replace the `AgentRooms` interface:

```ts
/** Room-level operations the live session service needs from LiveKit. */
export interface AgentRooms {
  dispatchAgent(sessionId: string): Promise<void>;
  hasAgent(sessionId: string): Promise<boolean>;
  /** An interviewer dispatch for the room that has not finished: its job not started yet, or still pending or running. */
  hasDispatch(sessionId: string): Promise<boolean>;
}

interface DispatchRecord {
  agent_name?: string;
  agentName?: string;
  deleted_at?: string | number;
  deletedAt?: string | number;
  state?: { jobs?: { state?: { status?: string | number } }[] };
}
/** A job that is over (LiveKit's JobStatus: JS_SUCCESS, JS_FAILED), by name or by number. */
const FINISHED_JOB = new Set<string | number>(["JS_SUCCESS", "JS_FAILED", 2, 3]);
```

Add this method to `LiveKitRoomAdmin`, after `hasAgent`:

```ts
  async hasDispatch(sessionId: string): Promise<boolean> {
    const room = `interview-${sessionId}`;
    try {
      const res = (await this.call("AgentDispatchService", "ListDispatch", room, { room })) as {
        agent_dispatches?: DispatchRecord[];
        agentDispatches?: DispatchRecord[];
      };
      return (res.agent_dispatches ?? res.agentDispatches ?? []).some((d) => {
        if ((d.agent_name ?? d.agentName) !== this.agentName) return false;
        if (Number(d.deleted_at ?? d.deletedAt ?? 0) > 0) return false;
        const jobs = d.state?.jobs ?? [];
        return jobs.length === 0 || jobs.some((j) => !FINISHED_JOB.has(j.state?.status ?? "JS_PENDING"));
      });
    } catch (err) {
      // No room yet means no dispatch yet.
      if (isUpstreamStatus(err, 404)) return false;
      throw err;
    }
  }
```

- [ ] **Step 6: Ad-hoc check that the module still loads** (no test run)

Run: `cd apps/api && pnpm exec tsx --env-file=.env -e "import('./src/integrations/livekit.ts').then((m) => console.log(typeof m.LiveKitRoomAdmin.prototype.hasDispatch))"`
Expected: `function`

- [ ] **Step 7: Run the tests to see them pass (only if the user asks)**

Run: `cd apps/api && pnpm exec vitest run test/integrations/liveKitRoomAdmin.test.ts`
Expected: PASS. Leave the changes uncommitted.

---

### Task 2: `LiveSessionService.warm`, guarded go-live dispatch, context for a ready round

**Files:**
- Modify: `apps/api/src/services/liveSessions.ts`
- Test: `apps/api/test/services/liveSessionService.test.ts`, `apps/api/test/routes/internalLive.test.ts`

**Interfaces:**
- Consumes: `AgentRooms.hasAgent`, `AgentRooms.hasDispatch`, `AgentRooms.dispatchAgent` (Task 1 and existing).
- Produces: `LiveSessionService.warm(candidateId: string, sessionId: string): Promise<WarmResponse>`; exported `interface WarmResponse { warming: boolean }`; `startLive` now dispatches only when no interviewer is in the room, on its way, or dispatched in the last 30 s; `context(sessionId)` also answers for a `PREP_READY` session.

- [ ] **Step 1: Write the failing service tests** — in `liveSessionService.test.ts`

Add `json` to the imports: `import { json } from "../support/fakeFetch.js";`. After the `expectJoinToken` helper add:

```ts
/** What LiveKit answers: by default an empty room with nothing dispatched. */
function livekit(answers: { participants?: unknown; dispatches?: unknown } = {}): void {
  env.fetch.reset();
  env.fetch.on("POST", /CreateDispatch$/, {});
  env.fetch.on("POST", /ListParticipants$/, answers.participants ?? { participants: [] });
  env.fetch.on("POST", /ListDispatch$/, answers.dispatches ?? { agent_dispatches: [] });
}
const dispatches = () => env.fetch.callsTo(/CreateDispatch$/);
```

Append these describes at the end of the file:

```ts
describe("LiveSessionService.warm", () => {
  it("dispatches the interviewer for a ready round and changes nothing else", async () => {
    livekit();
    const s = await session("PREP_READY");
    expect(await env.c.liveSessions.warm(user.id, s.id)).toEqual({ warming: true });
    expect(dispatches()).toHaveLength(1);
    expect(dispatches()[0]!.json).toMatchObject({ room: `interview-${s.id}`, agent_name: "interviewer" });
    const after = await row(s.id);
    expect(after.status).toBe("PREP_READY");
    expect(after.liveStartedAt).toBeNull();
    expect(await env.c.repos.blueprintSeen.slugsFor(user.id)).toEqual([]);
  });

  it("does not dispatch when an interviewer is already in the room", async () => {
    livekit({ participants: { participants: [{ identity: "agent-1", kind: "AGENT" }] } });
    const s = await session("PREP_READY");
    expect(await env.c.liveSessions.warm(user.id, s.id)).toEqual({ warming: true });
    expect(dispatches()).toHaveLength(0);
  });

  it("does not dispatch when an interviewer is already on its way", async () => {
    livekit({ dispatches: { agent_dispatches: [{ id: "AD_1", agent_name: "interviewer", state: { jobs: [] } }] } });
    const s = await session("PREP_READY");
    expect(await env.c.liveSessions.warm(user.id, s.id)).toEqual({ warming: true });
    expect(dispatches()).toHaveLength(0);
  });

  it("dispatches once for repeated and for concurrent warm-ups", async () => {
    livekit();
    const s = await session("PREP_READY");
    const [a, b] = await Promise.all([env.c.liveSessions.warm(user.id, s.id), env.c.liveSessions.warm(user.id, s.id)]);
    const again = await env.c.liveSessions.warm(user.id, s.id);
    expect([a, b, again]).toEqual([{ warming: true }, { warming: true }, { warming: true }]);
    expect(dispatches()).toHaveLength(1);
  });

  it.each(["SCHEDULED", "PREP_QUEUED", "PREP_FAILED", "COMPLETED", "ABORTED_TECHNICAL"] as const)(
    "a %s round is not warmed and LiveKit is never called",
    async (status) => {
      livekit();
      const s = await session(status);
      expect(await env.c.liveSessions.warm(user.id, s.id)).toEqual({ warming: false });
      expect(env.fetch.calls).toHaveLength(0);
    },
  );

  it("a round already live gets an interviewer again when its room has none", async () => {
    livekit();
    const s = await session("LIVE_IN_PROGRESS", { liveStartedAt: new Date(Date.now() - 120_000) });
    expect(await env.c.liveSessions.warm(user.id, s.id)).toEqual({ warming: true });
    expect(dispatches()).toHaveLength(1);
  });

  it("another candidate's round is 404", async () => {
    livekit();
    const other = await createUser(env);
    const theirs = await session("PREP_READY", {}, other.id);
    await expectStatus(env.c.liveSessions.warm(user.id, theirs.id), 404);
    await expectStatus(env.c.liveSessions.warm(user.id, randomUUID()), 404);
    expect(env.fetch.calls).toHaveLength(0);
  });

  it("is a quiet no-op for an account the live interviewer is not available to", async () => {
    const off = await createTestEnv();
    try {
      const u = await createUser(off);
      const jd = await off.c.repos.jds.insert({ company: "google", role: "software-engineer", level: "sde1", title: "SWE", source: "seed", active: true });
      const s = await off.c.repos.sessions.insert({
        candidateId: u.id, jobDescriptionId: jd.id, company: "google", role: "software-engineer", level: "sde1",
        roundType: "dsa", scheduledAt: new Date(Date.now() + 60_000), timezone: "UTC", status: "PREP_READY",
      });
      expect(await off.c.liveSessions.warm(u.id, s.id)).toEqual({ warming: false });
      expect(off.fetch.calls).toHaveLength(0);
    } finally {
      await off.close();
    }
  });

  it("answers warming false, without throwing, when LiveKit refuses the dispatch", async () => {
    livekit();
    env.fetch.on("POST", /CreateDispatch$/, () => json({ code: "internal" }, 500));
    const s = await session("PREP_READY");
    expect(await env.c.liveSessions.warm(user.id, s.id)).toEqual({ warming: false });
    expect(dispatches()).toHaveLength(1);
  });

  it("still dispatches when the presence check itself fails", async () => {
    livekit();
    env.fetch.on("POST", /ListParticipants$/, () => json({ code: "internal" }, 500));
    const s = await session("PREP_READY");
    expect(await env.c.liveSessions.warm(user.id, s.id)).toEqual({ warming: true });
    expect(dispatches()).toHaveLength(1);
  });
});

describe("LiveSessionService.startLive and the interviewer", () => {
  it("dispatches at go-live when nobody warmed the room, and not again when it was warmed", async () => {
    livekit();
    const cold = await session("PREP_READY");
    await env.c.liveSessions.startLive(user.id, cold.id);
    expect(dispatches()).toHaveLength(1);

    livekit();
    const warmed = await session("PREP_READY");
    await env.c.liveSessions.warm(user.id, warmed.id);
    await env.c.liveSessions.startLive(user.id, warmed.id);
    expect(dispatches()).toHaveLength(1); // the warm-up's dispatch is reused
  });

  it("reuses an interviewer that is already in the room", async () => {
    livekit({ participants: { participants: [{ identity: "agent-1", kind: "AGENT" }] } });
    const s = await session("PREP_READY");
    await env.c.liveSessions.startLive(user.id, s.id);
    expect(dispatches()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Update the internal context test** — in `apps/api/test/routes/internalLive.test.ts`, replace the first test's title and its `ready` lines

Replace the title `"gives the worker the round and a minimal profile, only while live"` with `"gives the worker the round and a minimal profile, while the round is live or ready"`. Replace

```ts
    const ready = await seedSession(env, user.id, jd, { status: "PREP_READY" });
    expect((await env.http.get(ctx(ready.id)).set("X-Internal-Api-Key", TEST_INTERNAL_KEY)).body.code).toBe("session_not_live");
    expect((await env.http.get(ctx(s.id))).status).toBe(401);
```

with

```ts
    // A ready round answers too: the interviewer loads it while the candidate reads the instructions.
    const ready = await seedSession(env, user.id, jd, { status: "PREP_READY" });
    const early = await env.http.get(ctx(ready.id)).set("X-Internal-Api-Key", TEST_INTERNAL_KEY);
    expect(early.status).toBe(200);
    expect(early.body).toMatchObject({ session_id: ready.id, status: "PREP_READY", first_name: "Asha" });
    // Any other status has no context to load.
    for (const status of ["SCHEDULED", "PREP_QUEUED", "PREP_FAILED", "COMPLETED", "ABORTED_TECHNICAL"] as const) {
      const other = await seedSession(env, user.id, jd, { status });
      const res = await env.http.get(ctx(other.id)).set("X-Internal-Api-Key", TEST_INTERNAL_KEY);
      expect([res.status, res.body.code]).toEqual([409, "session_not_live"]);
    }
    expect((await env.http.get(ctx(s.id))).status).toBe(401);
```

- [ ] **Step 3: Run to see them fail (only if the user asks)**

Run: `cd apps/api && pnpm exec vitest run test/services/liveSessionService.test.ts test/routes/internalLive.test.ts`
Expected: FAIL — `warm is not a function`; the ready-round context answers 409.

- [ ] **Step 4: Implement** — `apps/api/src/services/liveSessions.ts`

After the `LiveSessionResponse` interface add:

```ts
/** What a warm-up tells the page: an interviewer is in the room or on its way (`warming`), or nothing was started. */
export interface WarmResponse {
  warming: boolean;
}

type DispatchOutcome = "dispatched" | "already_there" | "failed";
```

In the class, replace `private readonly lastDispatch = new Map<string, number>();` with:

```ts
  private readonly lastDispatch = new Map<string, number>();
  private readonly dispatching = new Map<string, Promise<DispatchOutcome>>();
```

In `startLive`, replace `if (updated) await this.dispatch(sessionId);` with:

```ts
    if (updated) await this.dispatchUnlessPresent(sessionId);
```

After `getLive` add:

```ts
  /**
   * Get the interviewer into the room while the candidate reads the instructions (spec 2026-10-11). Owner only, and never an
   * error for a round that is not eligible. Changes nothing but the dispatch: no status, no seen problems, no clock.
   */
  async warm(candidateId: string, sessionId: string): Promise<WarmResponse> {
    const s = await this.requireOwned(candidateId, sessionId);
    const eligible = s.status === "LIVE_IN_PROGRESS" || (s.status === "PREP_READY" && this.live.isAvailableFor(candidateId));
    if (!eligible) return { warming: false };
    return { warming: (await this.dispatchUnlessPresent(sessionId)) !== "failed" };
  }
```

In `context`, replace

```ts
    if (!s) throw InterviewSessionError.notFound();
    if (s.status !== "LIVE_IN_PROGRESS") throw InterviewSessionError.conflict("session_not_live", "the session is not live");
    const [{ firstName, profile }
```

with

```ts
    if (!s) throw InterviewSessionError.notFound();
    // A ready round answers too: the interviewer loads it while the candidate reads the instructions.
    if (s.status !== "LIVE_IN_PROGRESS" && s.status !== "PREP_READY") {
      throw InterviewSessionError.conflict("session_not_live", "the session is not live");
    }
    const [{ firstName, profile }
```

Replace the whole `private async dispatch(...)` method with:

```ts
  /** Whether LiveKit took the dispatch. A refused one is not remembered, so the next resume or warm-up tries again. */
  private async dispatch(sessionId: string): Promise<boolean> {
    if (!this.rooms) return false;
    try {
      await this.rooms.dispatchAgent(sessionId);
      this.lastDispatch.set(sessionId, Date.now());
      return true;
    } catch (err) {
      // The candidate still gets a token and enters; the next resume checks the room and dispatches again.
      this.log?.warn(`interviewer dispatch failed for session ${sessionId}: ${errorMessage(err)}`);
      return false;
    }
  }

  /** Concurrent callers for one session share one attempt (a page that mounts twice must not start two interviewers). */
  private dispatchUnlessPresent(sessionId: string): Promise<DispatchOutcome> {
    const running = this.dispatching.get(sessionId);
    if (running) return running;
    const attempt = this.dispatchIfAbsent(sessionId).finally(() => this.dispatching.delete(sessionId));
    this.dispatching.set(sessionId, attempt);
    return attempt;
  }

  /**
   * Dispatch the interviewer unless one is in the room, is already on its way, or was dispatched in the last 30 s. A failed
   * presence check does not stop the dispatch: a second interviewer leaves by itself (the worker's guard), a missing one cannot.
   */
  private async dispatchIfAbsent(sessionId: string): Promise<DispatchOutcome> {
    if (!this.rooms) return "failed";
    const outcome = await this.decide(sessionId);
    this.log?.info(`interviewer for session ${sessionId}: ${outcome}`);
    return outcome;
  }

  private async decide(sessionId: string): Promise<DispatchOutcome> {
    const last = this.lastDispatch.get(sessionId);
    if (last !== undefined && Date.now() - last < REDISPATCH_AFTER_MS) return "already_there";
    try {
      if ((await this.rooms!.hasAgent(sessionId)) || (await this.rooms!.hasDispatch(sessionId))) return "already_there";
    } catch (err) {
      this.log?.warn(`interviewer presence check failed for session ${sessionId}: ${errorMessage(err)}`);
    }
    return (await this.dispatch(sessionId)) ? "dispatched" : "failed";
  }
```

`ensureAgent` is unchanged: it keeps its own presence check (a failed check there means "do not dispatch") and calls `this.dispatch(s.id)`, whose boolean it ignores.

- [ ] **Step 5: Ad-hoc check that the module loads** (no test run)

Run: `cd apps/api && pnpm exec tsx --env-file=.env -e "import('./src/services/liveSessions.ts').then((m) => console.log(typeof m.LiveSessionService.prototype.warm))"`
Expected: `function`

- [ ] **Step 6: Run the tests to see them pass (only if the user asks)**

Run: `cd apps/api && pnpm exec vitest run test/services/liveSessionService.test.ts test/routes/internalLive.test.ts test/routes/interviewSessionLiveController.test.ts`
Expected: PASS. The existing "dispatches the interviewer at go-live, and a failed dispatch still lets the candidate in" and "re-dispatches on resume…" tests must still pass unchanged: go-live's unregistered `ListParticipants` fails inside `decide`, is logged, and the dispatch still goes out once. Leave the changes uncommitted.

---

### Task 3: Route, OpenAPI contract, regenerated web types

**Files:**
- Modify: `apps/api/src/routes/interviews.ts`, `packages/contracts/openapi.yaml`
- Regenerate: `apps/web/lib/api-client/generated/schema.d.ts`
- Test: `apps/api/test/routes/interviewSessionLiveController.test.ts`

**Interfaces:**
- Consumes: `LiveSessionService.warm` (Task 2).
- Produces: `POST /api/v1/interviews/sessions/{sessionId}/live/warm` → `200 { "warming": boolean }`; the generated type `components["schemas"]["WarmLiveResponse"]`.

- [ ] **Step 1: Write the failing route test** — append to `interviewSessionLiveController.test.ts`, after the `describe("agent dispatch", …)` block

```ts
describe("POST /sessions/:id/live/warm", () => {
  const warm = (sessionId: string) => `${live(sessionId)}/warm`;

  it("warms a ready round without touching it, is a quiet no-op for any other, and is owner-only", async () => {
    env.fetch.reset();
    env.fetch.on("POST", /CreateDispatch$/, {});
    env.fetch.on("POST", /ListParticipants$/, { participants: [] });
    env.fetch.on("POST", /ListDispatch$/, { agent_dispatches: [] });
    const user = await createUser(env);
    const s = await seedSession(env, user.id, jd, { status: "PREP_READY" });

    const res = await env.http.post(warm(s.id)).set("Authorization", await bearer(env, user));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ warming: true });
    expect(env.fetch.callsTo(/CreateDispatch/)).toHaveLength(1);
    expect((await env.c.repos.sessions.findById(s.id))?.status).toBe("PREP_READY");

    const booked = await seedSession(env, user.id, jd, { status: "SCHEDULED" });
    const quiet = await env.http.post(warm(booked.id)).set("Authorization", await bearer(env, user));
    expect([quiet.status, quiet.body]).toEqual([200, { warming: false }]);

    const stranger = await env.http.post(warm(s.id)).set("Authorization", await bearer(env, await createUser(env)));
    expect(stranger.status).toBe(404);
    expect((await env.http.post(warm(randomUUID()))).status).toBe(401);
  });
});
```

- [ ] **Step 2: Run to see it fail (only if the user asks)**

Run: `cd apps/api && pnpm exec vitest run test/routes/interviewSessionLiveController.test.ts`
Expected: FAIL — the warm route answers 404 (no such route).

- [ ] **Step 3: Add the route** — `apps/api/src/routes/interviews.ts`, after the `r.get("/sessions/:sessionId/live", …)` handler

```ts
  /** Get the interviewer into the room while the candidate reads the instructions: best effort, never an error for a round that is not eligible. */
  r.post("/sessions/:sessionId/live/warm", async (req, res) => {
    res.json(await c.liveSessions.warm(userId(req), uuidParam(req, "sessionId")));
  });
```

- [ ] **Step 4: Add the contract** — `packages/contracts/openapi.yaml`

Insert this path block immediately before `  /api/v1/interviews/sessions/{sessionId}/live/end:`:

```yaml
  /api/v1/interviews/sessions/{sessionId}/live/warm:
    parameters:
      - $ref: "#/components/parameters/SessionId"
    post:
      operationId: warmLiveInterviewSession
      tags: [interview-sessions]
      summary: Get the interviewer into the room while the candidate reads the instructions.
      description: >
        Best effort and idempotent. For a PREP_READY round the live interviewer is available for (or one that is already
        LIVE_IN_PROGRESS) it dispatches the interviewer into the room unless one is already there or on its way, so the
        interviewer is waiting when the candidate enters. It changes nothing else: no status change, no seen problems, no
        clock. Any other round answers `warming: false`. Only the owning candidate may call this.
      security: [{ bearerAuth: [] }]
      responses:
        "200":
          description: Whether an interviewer is in the room or on its way.
          content: { application/json: { schema: { $ref: "#/components/schemas/WarmLiveResponse" } } }
        "401": { $ref: "#/components/responses/Unauthorized" }
        "404": { $ref: "#/components/responses/NotFound" }
```

Insert this schema immediately before `    GoLiveResponse:`:

```yaml
    WarmLiveResponse:
      type: object
      required: [warming]
      properties:
        warming:
          type: boolean
          description: True when an interviewer is in the room, on its way, or was just dispatched.
```

In the `getLiveContext` operation, change `summary: The round and a minimal profile for the interviewer worker.` to `summary: The round and a minimal profile for the interviewer worker (while the round is PREP_READY or LIVE_IN_PROGRESS).` and the `"409"` description from `` "`session_not_live`." `` to `` "`session_not_live`: the session is neither PREP_READY nor LIVE_IN_PROGRESS." ``.

- [ ] **Step 5: Regenerate the web types**

Run: `pnpm contracts:types` (from the repo root)
Expected: `apps/web/lib/api-client/generated/schema.d.ts` changes; confirm with `grep -n "WarmLiveResponse\|warmLiveInterviewSession" apps/web/lib/api-client/generated/schema.d.ts` (both appear).

- [ ] **Step 6: Run the tests to see them pass (only if the user asks)**

Run: `cd apps/api && pnpm exec vitest run test/routes/interviewSessionLiveController.test.ts`
Expected: PASS. Leave the changes uncommitted.

---

### Task 4: The worker holds the round until the candidate arrives

**Files:**
- Modify: `apps/ai-service/app/interviewer/run.py`, `apps/ai-service/app/interviewer/agent.py`, `apps/ai-service/app/interviewer/worker.py`
- Test: `apps/ai-service/tests/interviewer/test_run.py`, `apps/ai-service/tests/interviewer/test_worker.py`, `apps/ai-service/tests/interviewer/test_agent.py` (new)

**Interfaces:**
- Produces on `InterviewRun`: `begun: asyncio.Event` (set once `start()` has run and the interview is not already finished); `on_web_message` holds messages until `begun` is set and replays them in order at the end of `start()`.
- Produces in `worker.py`: `WAIT_FOR_CANDIDATE_S = 15 * 60`; `class StageClock(session_id, now=time.monotonic)` with `.mark(stage: str)` (logs each stage once); `async def blueprint_changed(session_id: str, loaded: dict) -> bool`; `async def begin_when_candidate_arrives(*, bridge, run, store, session_id, blueprint, wait_s=WAIT_FOR_CANDIDATE_S, on_hello=None) -> str` returning `"started" | "ended" | "nobody" | "changed"`.
- Produces on `InterviewerAgent`: `on_enter` waits for `run.begun` before it asks for the greeting.

- [ ] **Step 1: Preconditions**

Run: `git status --short apps/ai-service`
Expected: nothing under `app/interviewer/` or `tests/interviewer/` that you did not change (the earlier `said.py`, `talker.py`, `run.py`, `prompts.py`, test edits from the repeat-sentence work are expected). Anything else: stop and ask.

Run (no blueprint prep may be in flight):

```bash
cd apps/ai-service && PYTHONPATH=. .venv/bin/python - <<'EOF'
import asyncio
from pathlib import Path
from motor.motor_asyncio import AsyncIOMotorClient
env = dict(l.split("=", 1) for l in Path(".env").read_text().splitlines() if "=" in l and not l.startswith("#"))
async def main():
    db = AsyncIOMotorClient(env["MONGODB_URL"].strip())[env.get("MONGODB_DATABASE", "interviewiq_intelligence").strip()]
    print("in flight:", await db.blueprint_runs.count_documents({"status": {"$in": ["running", "queued", "pending", "in_progress"]}}))
asyncio.run(main())
EOF
```
Expected: `in flight: 0`. If not 0, wait and re-check; do not edit while prep runs.

- [ ] **Step 2: Write the failing tests**

Append to `tests/interviewer/test_run.py`:

```python
def test_messages_that_arrive_before_the_round_starts_are_held_and_handled_in_order_once_it_has():
    async def go():
        run, _, _ = make([say("Hello.")])
        assert not run.begun.is_set()
        tab = {"type": "proctor.event", "kind": "tab_hidden", "weight": 1, "at": 1, "counts": {"tab_changes": 1, "screen_changes": 0, "full_violations": 0}}
        await run.on_web_message(web(tab))
        await run.on_web_message(web({"type": "code.snapshot", "version": 1, "language": "python", "text": "x = 1"}))
        assert len(run._early) == 2 and run.conductor.live_summary()["tab_changes"] == 0
        await run.start(None)
        return run

    run = asyncio.run(go())
    assert run.begun.is_set() and run._early == []
    assert run.conductor.live_summary()["tab_changes"] == 1          # the held proctor event was handled after the start


def test_a_finished_interview_never_begins_so_it_is_never_greeted_again():
    async def go():
        run, _, _ = make([say("Hello.")])
        await run.start({"ended_at": "2026-10-10T20:00:00+00:00", "end_reason": "completed", "history": []})
        return run

    run = asyncio.run(go())
    assert run.ended_run is not None and not run.begun.is_set()
```

Create `tests/interviewer/test_agent.py`:

```python
"""The interviewer agent holds its greeting until the round has started."""
import asyncio
from types import SimpleNamespace

from app.interviewer.agent import InterviewerAgent


def test_the_greeting_waits_for_the_round_to_start():
    async def go():
        asked: list[int] = []
        run = SimpleNamespace(begun=asyncio.Event())
        agent = SimpleNamespace(run=run, session=SimpleNamespace(generate_reply=lambda: asked.append(1)))
        entering = asyncio.create_task(InterviewerAgent.on_enter(agent))
        await asyncio.sleep(0.01)
        assert asked == [] and not entering.done()      # the interviewer is in the room, but nobody has arrived
        run.begun.set()
        await asyncio.wait_for(entering, 1)
        return asked

    assert asyncio.run(go()) == [1]
```

Append to `tests/interviewer/test_worker.py`:

```python
def test_the_stage_clock_logs_each_stage_once_in_milliseconds_since_the_job_was_received(caplog):
    import logging

    from app.interviewer.worker import StageClock

    now = [100.0]
    clock = StageClock("s1", now=lambda: now[0])
    with caplog.at_level(logging.INFO, logger="app.interviewer.worker"):
        now[0] = 101.5
        clock.mark("room_joined")
        clock.mark("room_joined")           # every stage is logged once, however often it is marked
        now[0] = 103.0
        clock.mark("begin")
    lines = [r.getMessage() for r in caplog.records]
    assert lines == ["interviewer stage room_joined at 1500 ms (session s1)", "interviewer stage begin at 3000 ms (session s1)"]


def _fakes(*, hello=True, changed=False, ended=False):
    import asyncio

    class Bridge:
        async def wait_ready(self, timeout):
            return hello

    class Run:
        ended_run = None
        started_with = "not started"

        async def start(self, saved):
            self.started_with = saved
            self.ended_run = {"ended_at": "x"} if ended else None

    class Store:
        async def load_run(self, session_id):
            return {"seq": 3}

    return asyncio, Bridge(), Run(), Store()


def test_the_round_starts_when_the_candidate_says_hello(monkeypatch):
    from app.interviewer import worker

    async def same(session_id, loaded):
        return False

    monkeypatch.setattr(worker, "blueprint_changed", same)
    asyncio, bridge, run, store = _fakes()
    hello = []
    outcome = asyncio.run(worker.begin_when_candidate_arrives(bridge=bridge, run=run, store=store, session_id="s1",
                                                               blueprint={}, on_hello=lambda: hello.append(1)))
    assert outcome == "started" and run.started_with == {"seq": 3} and hello == [1]


def test_nobody_coming_means_the_round_never_starts(monkeypatch):
    from app.interviewer import worker

    asyncio, bridge, run, store = _fakes(hello=False)
    outcome = asyncio.run(worker.begin_when_candidate_arrives(bridge=bridge, run=run, store=store, session_id="s1", blueprint={}, wait_s=0.01))
    assert outcome == "nobody" and run.started_with == "not started"


def test_a_blueprint_re_prepared_while_waiting_means_leaving_without_starting(monkeypatch):
    from app.interviewer import worker

    async def changed(session_id, loaded):
        return True

    monkeypatch.setattr(worker, "blueprint_changed", changed)
    asyncio, bridge, run, store = _fakes()
    outcome = asyncio.run(worker.begin_when_candidate_arrives(bridge=bridge, run=run, store=store, session_id="s1", blueprint={}))
    assert outcome == "changed" and run.started_with == "not started"


def test_an_interview_that_had_already_finished_is_reported_as_ended(monkeypatch):
    from app.interviewer import worker

    async def same(session_id, loaded):
        return False

    monkeypatch.setattr(worker, "blueprint_changed", same)
    asyncio, bridge, run, store = _fakes(ended=True)
    outcome = asyncio.run(worker.begin_when_candidate_arrives(bridge=bridge, run=run, store=store, session_id="s1", blueprint={}))
    assert outcome == "ended"


def test_the_blueprint_counts_as_changed_only_when_its_id_or_version_differ(monkeypatch):
    import asyncio

    from app.interviewer import worker

    loaded = {"blueprint_id": "b1", "version": 2}

    async def current(session_id):
        return current.answer

    monkeypatch.setattr(worker.bp_store, "current_blueprint", current)
    for answer, expected in (({"blueprint_id": "b1", "version": 2}, False), ({"blueprint_id": "b1", "version": 3}, True),
                             ({"blueprint_id": "b9", "version": 2}, True), (None, False)):
        current.answer = answer
        assert asyncio.run(worker.blueprint_changed("s1", loaded)) is expected
```

- [ ] **Step 3: Run to see them fail (only if the user asks)**

Run: `cd apps/ai-service && .venv/bin/python -m pytest -q tests/interviewer/test_run.py tests/interviewer/test_agent.py tests/interviewer/test_worker.py`
Expected: FAIL — `begun` / `StageClock` / `begin_when_candidate_arrives` do not exist.

- [ ] **Step 4: `run.py` — the round starts on `begin`**

In `InterviewRun.__init__`, after `self._tasks: set[asyncio.Task] = set()` add:

```python
        self.begun = asyncio.Event()                  # the round has started (the candidate arrived); the greeting waits for it
        self._early: list[Any] = []                   # what the browser sent before then, handled in order once it has
```

Rename the existing `async def start(self, saved: …)` to `async def _start(self, saved: …)` (body unchanged) and insert above it:

```python
    async def start(self, saved: dict[str, Any] | None) -> None:
        """Load or restore the round and start its clock. The worker calls this when the candidate arrives, not when the
        interviewer joins the room. An interview that had already finished never begins (it is never greeted again)."""
        await self._start(saved)
        if self.ended_run is not None:
            return
        self.begun.set()
        early, self._early = self._early, []
        for message in early:                          # no await inside on_web_message, so nothing can interleave
            await self.on_web_message(message)
```

At the top of `on_web_message`, before `if m.type == "activity.batch":`, add:

```python
        if not self.begun.is_set():
            self._early.append(m)                      # the round has not started: held, then handled in order
            return
```

- [ ] **Step 5: `agent.py` — the greeting waits**

Replace `InterviewerAgent.on_enter` with:

```python
    async def on_enter(self) -> None:
        await self.run.begun.wait()    # the interviewer may be in the room long before the candidate: the round starts with them
        self.session.generate_reply()  # the opening turn: the run's greeting
```

- [ ] **Step 6: `worker.py` — imports and helpers**

Add `import time` and `from typing import Any, Callable` (replace `from typing import Any`) to the imports. After `ROOM_PREFIX = "interview-"` add:

```python
WAIT_FOR_CANDIDATE_S = 15 * 60   # a waiting interviewer leaves after this long with no candidate (spec 2026-10-11 §4.3)
```

After `_is_agent` add:

```python
class StageClock:
    """One log line per stage of the start-up, in milliseconds since the job was received (spec 2026-10-11 §7)."""

    def __init__(self, session_id: str, now: Callable[[], float] = time.monotonic) -> None:
        self.session_id, self._now = session_id, now
        self._t0 = now()
        self._seen: set[str] = set()

    def mark(self, stage: str) -> None:
        if stage in self._seen:
            return
        self._seen.add(stage)
        logger.info("interviewer stage %s at %d ms (session %s)", stage, int((self._now() - self._t0) * 1000), self.session_id)


async def blueprint_changed(session_id: str, loaded: dict[str, Any]) -> bool:
    """The blueprint was re-prepared while the interviewer waited (the reconcile job does that until 30 minutes before the slot)."""
    current = await bp_store.current_blueprint(session_id)
    return current is not None and (current.get("blueprint_id"), current.get("version")) != (loaded.get("blueprint_id"), loaded.get("version"))


async def begin_when_candidate_arrives(*, bridge, run, store, session_id: str, blueprint: dict[str, Any],
                                       wait_s: float = WAIT_FOR_CANDIDATE_S, on_hello: Callable[[], None] | None = None) -> str:
    """Hold the round until the candidate's browser says hello, then start it. Returns "started"; "ended" (this interview had
    already finished); "nobody" (no hello within `wait_s`); or "changed" (the blueprint was re-prepared while waiting)."""
    if not await bridge.wait_ready(wait_s):
        return "nobody"
    if on_hello is not None:
        on_hello()
    if await blueprint_changed(session_id, blueprint):
        return "changed"
    await run.start(await store.load_run(session_id))
    return "ended" if run.ended_run is not None else "started"
```

- [ ] **Step 7: `worker.py` — the entrypoint**

At the top of `entrypoint`, right after `api = ApiClient(...)`, add `clock = StageClock(session_id)` and `clock.mark("job_received")`. After `await ctx.connect()` add `clock.mark("room_joined")`. After `context = await api.context(session_id)` add `clock.mark("context_loaded")`.

Replace everything from `@ctx.room.on("participant_disconnected")` down to and including the `finally: ticker.cancel(); await session.aclose()` block (the end of the inner `try`) with:

```python
        @session.on("agent_state_changed")
        def _first_audio(ev) -> None:
            if str(ev.new_state) == "speaking" and run.begun.is_set():
                clock.mark("first_audio")

        # Before the round starts nobody has been heard from: a candidate leaving or coming back means nothing to the run yet.
        @ctx.room.on("participant_disconnected")
        def _left(participant) -> None:
            if not _is_agent(participant) and run.begun.is_set():
                run.on_candidate_left()

        @ctx.room.on("participant_connected")
        def _back(participant) -> None:
            if not _is_agent(participant) and run.begun.is_set():
                run.on_candidate_back()

        # The interviewer is in the room with its speech connections up while the round waits for the candidate's first
        # hello. What the browser sends before the round starts is held by the run, never lost. close_on_disconnect=False:
        # a page refresh drops the candidate for a few seconds and LiveKit would close the session with them; the run
        # decides what an absence means (a violation, then "technical").
        await bridge.start_handling(run.on_web_message)
        await session.start(agent=InterviewerAgent(run), room=ctx.room,
                            room_options=room_io.RoomOptions(close_on_disconnect=False))
        clock.mark("session_started")
        ticker: asyncio.Task | None = None
        try:
            outcome = await begin_when_candidate_arrives(bridge=bridge, run=run, store=store, session_id=session_id,
                                                         blueprint=blueprint, on_hello=lambda: clock.mark("hello"))
            clock.mark("begin")
            if outcome == "nobody":
                logger.info("no candidate came to %s within %d s; leaving", ctx.room.name, WAIT_FOR_CANDIDATE_S)
                await ctx.delete_room()          # the session is untouched: it stays PREP_READY
                return
            if outcome == "changed":
                logger.info("the blueprint for %s was re-prepared while the interviewer waited; leaving for a fresh interviewer", session_id)
                ctx.shutdown("blueprint re-prepared")   # the page's nudge re-dispatches one that loads the new blueprint
                return
            if outcome == "ended":
                logger.info("session %s had already finished; repeating its ending", session_id)
                await run.reaffirm_end()
                return
            ticker = asyncio.create_task(run.tick_forever())
            await run.finished.wait()
        finally:
            if ticker is not None:
                ticker.cancel()
            await session.aclose()
```

(The old `await run.start(...)`, `await bridge.start_handling(...)`, the `ended_run` check, the `session.start(...)` call, and the old ticker block are all replaced by the above; nothing of them remains.)

- [ ] **Step 8: Ad-hoc check** (no pytest)

```bash
cd apps/ai-service && PYTHONPATH=. .venv/bin/python - <<'EOF'
import asyncio
from types import SimpleNamespace
from app.interviewer import worker
from app.interviewer.agent import InterviewerAgent

async def same(session_id, loaded): return False
worker.blueprint_changed = same

class Bridge:
    def __init__(self, hello): self.hello = hello
    async def wait_ready(self, t): return self.hello
class Run:
    ended_run = None
    async def start(self, saved): pass
class Store:
    async def load_run(self, s): return None

async def main():
    for hello, want in ((True, "started"), (False, "nobody")):
        got = await worker.begin_when_candidate_arrives(bridge=Bridge(hello), run=Run(), store=Store(), session_id="s", blueprint={}, wait_s=0.01)
        print("ok " if got == want else "BAD", hello, got)
    asked = []
    run = SimpleNamespace(begun=asyncio.Event())
    agent = SimpleNamespace(run=run, session=SimpleNamespace(generate_reply=lambda: asked.append(1)))
    t = asyncio.create_task(InterviewerAgent.on_enter(agent)); await asyncio.sleep(0.01)
    print("ok " if asked == [] and not t.done() else "BAD", "greeting held")
    run.begun.set(); await asyncio.wait_for(t, 1)
    print("ok " if asked == [1] else "BAD", "greeting after begin")
asyncio.run(main())
import app.interviewer.run, app.interviewer.worker; print("ok  imports")
EOF
```
Expected: every line starts with `ok`.

- [ ] **Step 9: Run the tests to see them pass (only if the user asks)**

Run: `cd apps/ai-service && .venv/bin/python -m pytest -q tests/interviewer`
Expected: PASS. The existing `test_run.py` tests call `await run.start(None)` before any web message, so they are unaffected. Leave the changes uncommitted.

- [ ] **Step 10: Restart the worker onto the new code** (it does not hot-reload)

Run: `ps aux | grep "interviewer.worker" | grep -v grep` — if a job process is in the middle of a round (a log line `received job request` without a later `process exiting`), wait; otherwise `kill <pid>` and start `cd apps/ai-service && .venv/bin/python -m app.interviewer.worker dev` in the background; confirm `registered worker … agent_name: interviewer` in its log.

---

### Task 5: Web — warm on the instructions page, enter once the interviewer is there

**Files:**
- Modify: `apps/web/lib/constants/interview/index.ts`, `apps/web/features/interview/types.ts`, `apps/web/features/interview/api.ts`, `apps/web/features/interview-live/session/LiveKitLiveSession.ts`, `apps/web/app/(app)/interviews/[sessionId]/live/_components/LiveInterview.tsx`
- Create: `apps/web/features/interview-live/session/useWarmInterviewer.ts`
- Test: `apps/web/features/interview/live-api.test.ts`, `apps/web/features/interview-live/session/useWarmInterviewer.test.tsx` (new), `apps/web/features/interview-live/session/LiveKitLiveSession.test.ts`, `apps/web/app/(app)/interviews/[sessionId]/live/_components/LiveInterview.test.tsx`, `…/LiveInterview.gating.test.tsx`

**Interfaces:**
- Consumes: `WarmLiveResponse` (generated, Task 3).
- Produces: `warmLive(id: string): Promise<WarmLiveResponse>`; `INTERVIEW_ENDPOINTS.liveWarm(id)`; `useWarmInterviewer(sessionId: string, enabled: boolean): void`; `AGENT_WAIT_MS = 15_000` exported from `LiveKitLiveSession.ts`; `LiveKitLiveSession.connect` resolves only once an interviewer is in the room or `AGENT_WAIT_MS` has passed.

- [ ] **Step 1: Write the failing tests**

In `features/interview/live-api.test.ts` change the import to `import { goLive, getLive, warmLive } from "./api";` and append inside the `describe`:

```ts
  it("warmLive POSTs to the warm endpoint", async () => {
    const spy = vi.spyOn(client, "apiFetch").mockResolvedValue({ warming: true } as never);
    const res = await warmLive("s1");
    expect(spy).toHaveBeenCalledWith(INTERVIEW_ENDPOINTS.liveWarm("s1"), { method: "POST" });
    expect(INTERVIEW_ENDPOINTS.liveWarm("s1")).toBe(`${INTERVIEW_ENDPOINTS.live("s1")}/warm`);
    expect(res.warming).toBe(true);
  });
```

Create `features/interview-live/session/useWarmInterviewer.test.tsx`:

```tsx
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const warmLive = vi.fn(async (_id: string) => ({ warming: true }))
vi.mock('@/features/interview/api', () => ({ warmLive: (id: string) => warmLive(id) }))
const mock = vi.hoisted(() => ({ on: false }))
vi.mock('./mockMode', () => ({ isMockMode: () => mock.on }))

import { useWarmInterviewer } from './useWarmInterviewer'

describe('useWarmInterviewer', () => {
  beforeEach(() => {
    warmLive.mockReset()
    warmLive.mockImplementation(async () => ({ warming: true }))
    mock.on = false
  })

  it('asks the API to get the interviewer ready, once, however often the page re-renders or remounts the check', () => {
    const { rerender } = renderHook(({ on }) => useWarmInterviewer('s1', on), { initialProps: { on: true } })
    rerender({ on: true })
    rerender({ on: false })
    rerender({ on: true })
    expect(warmLive).toHaveBeenCalledTimes(1)
    expect(warmLive).toHaveBeenCalledWith('s1')
  })

  it('does nothing while it is not the instructions page', () => {
    renderHook(() => useWarmInterviewer('s1', false))
    expect(warmLive).not.toHaveBeenCalled()
  })

  it('does nothing in local mock mode', () => {
    mock.on = true
    renderHook(() => useWarmInterviewer('s1', true))
    expect(warmLive).not.toHaveBeenCalled()
  })

  it('swallows a failed call: the room still works without it', async () => {
    warmLive.mockRejectedValueOnce(new Error('offline'))
    renderHook(() => useWarmInterviewer('s1', true))
    await new Promise((resolve) => setTimeout(resolve, 0)) // an unhandled rejection would fail the run
    expect(warmLive).toHaveBeenCalledTimes(1)
  })
})
```

In `features/interview-live/session/LiveKitLiveSession.test.ts`:
- change the vitest import to `import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'`;
- add `agentHere: true,` to the hoisted `h` object;
- in the mocked `Room` class replace `remoteParticipants = new Map()` with
  `get remoteParticipants() { return new Map(h.agentHere ? [['agent-1', { isAgent: true, attributes: {} }]] : []) }`;
- change the import line to `import { AGENT_WAIT_MS, LiveKitLiveSession } from './LiveKitLiveSession'`;
- in `beforeEach` add `h.agentHere = true`, and add `afterEach(() => { vi.useRealTimers() })` inside the describe;
- in the test `'reports the agent state from its participant attribute'` change the expectation to `expect(states).toEqual(['initializing', 'thinking', 'absent'])` (the interviewer already in the room at connect is reported first);
- append inside the describe:

```ts
  it('stays connecting until the interviewer joins the room, then reports connected', async () => {
    vi.useFakeTimers()
    h.agentHere = false
    const s = new LiveKitLiveSession()
    const connecting = s.connect('s1')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(s.connectionState).toBe('connecting')
    h.on['participantConnected']({ isAgent: true, attributes: {} })
    await connecting
    expect(s.connectionState).toBe('connected')
  })

  it('gives up waiting after AGENT_WAIT_MS and enters the room anyway', async () => {
    vi.useFakeTimers()
    h.agentHere = false
    const s = new LiveKitLiveSession()
    const connecting = s.connect('s1')
    await vi.advanceTimersByTimeAsync(AGENT_WAIT_MS - 1)
    expect(s.connectionState).toBe('connecting')
    await vi.advanceTimersByTimeAsync(2)
    await connecting
    expect(s.connectionState).toBe('connected')
  })
```

In `LiveInterview.test.tsx` and `LiveInterview.gating.test.tsx`, directly under the existing `vi.mock("@/features/interview/hooks", …)` call add (these pages now warm the interviewer on mount; keep the network out of the tests):

```tsx
vi.mock("@/features/interview/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/interview/api")>()),
  warmLive: vi.fn(async () => ({ warming: false })),
}));
```

- [ ] **Step 2: Run to see them fail (only if the user asks)**

Run: `cd apps/web && pnpm exec vitest run features/interview features/interview-live/session`
Expected: FAIL — `warmLive`, `useWarmInterviewer` and `AGENT_WAIT_MS` do not exist.

- [ ] **Step 3: Endpoint, type and client**

`lib/constants/interview/index.ts`: add after the `liveEnd` line:

```ts
  liveWarm: (id: string) => `${SESSIONS}/${id}/live/warm`,
```

`features/interview/types.ts`: add after the `GoLiveResponse` line:

```ts
export type WarmLiveResponse = components["schemas"]["WarmLiveResponse"];
```

`features/interview/api.ts`: add `WarmLiveResponse,` to the type import list, and after `getLive` add:

```ts
/** POST /api/v1/interviews/sessions/{id}/live/warm — get the interviewer into the room while the candidate reads the instructions (best effort). */
export function warmLive(id: string): Promise<WarmLiveResponse> {
  return apiFetch<WarmLiveResponse>(INTERVIEW_ENDPOINTS.liveWarm(id), { method: "POST" });
}
```

- [ ] **Step 4: The hook** — create `features/interview-live/session/useWarmInterviewer.ts`

```ts
'use client'
import { useEffect, useRef } from 'react'
import { warmLive } from '@/features/interview/api'
import { isMockMode } from './mockMode'

/** While the instructions page is open the interviewer is got ready in the background (spec 2026-10-11): one call per mount,
 * best effort. Entering the room works the same whether or not this call was made or succeeded. */
export function useWarmInterviewer(sessionId: string, enabled: boolean): void {
  const fired = useRef(false)
  useEffect(() => {
    if (!enabled || fired.current || isMockMode()) return
    fired.current = true
    void warmLive(sessionId).catch(() => {})
  }, [enabled, sessionId])
}
```

- [ ] **Step 5: Wait for the interviewer on connect** — `features/interview-live/session/LiveKitLiveSession.ts`

After the `AGENT_STATES` constant add:

```ts
/** How long entering waits for the interviewer to be in the room before showing the room anyway. */
export const AGENT_WAIT_MS = 15_000
```

Add the field next to the other private fields: `private agentJoined: (() => void) | null = null`.

Replace the `ParticipantConnected` handler line with:

```ts
      room.on(RoomEvent.ParticipantConnected, (p: Participant) => {
        if (p.isAgent) {
          this.emitAgent(agentStateOf(p))
          this.agentJoined?.()
        }
      })
```

In `connect`, immediately before the final `if (this.connectionState === 'connecting') this.setConn('connected')` line add:

```ts
    // An empty room reads as broken: enter once the interviewer is in it (the instructions page usually got it there already).
    await this.waitForAgent(AGENT_WAIT_MS)
```

Add the method after `disconnect`:

```ts
  /** Resolves when an interviewer is in the room, or after `ms`. It does not depend on the browser's hello, so it cannot deadlock. */
  private waitForAgent(ms: number): Promise<void> {
    const here = () => !!this.room && Array.from(this.room.remoteParticipants.values()).some((p) => p.isAgent)
    if (here()) return Promise.resolve()
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer)
        this.agentJoined = null
        resolve()
      }
      const timer = setTimeout(done, ms)
      this.agentJoined = done
    })
  }
```

- [ ] **Step 6: Use the hook and say what is happening** — `LiveInterview.tsx`

Add the import `import { useWarmInterviewer } from "@/features/interview-live/session/useWarmInterviewer";` next to the other `session/` imports. In `LiveInterviewInner`, after `const router = useRouter();` add:

```tsx
  // The instructions page is open: get the interviewer into the room while the candidate reads (one call, best effort).
  useWarmInterviewer(sessionId, state === "prejoin");
```

and change the spinner label `state === "connecting" ? "Connecting to your interviewer…" : \`${state}…\`` to `state === "connecting" ? "Your interviewer is joining…" : \`${state}…\``. Leave the notice text in `ProctorBars.tsx` as it is.

- [ ] **Step 7: Run the tests to see them pass (only if the user asks)**

Run: `cd apps/web && pnpm exec vitest run features/interview features/interview-live app/\(app\)/interviews`
Expected: PASS. If a test that renders the live room with a real `LiveKitLiveSession` now waits 15 s for an interviewer, give its Room mock an agent participant the same way as in Step 1. Leave the changes uncommitted.

---

### Task 6: Verify by hand, update the spec, remove the spike

**Files:**
- Modify: `docs/superpowers/specs/2026-10-11-warm-interviewer-design.md`
- Delete: `apps/api/scripts/dev/spike-livekit-dispatch.ts`

- [ ] **Step 1: Manual join with timing** (the user does the browser part; Claude reads the logs)

1. Confirm the API (:8080), web (:3000), ai-service (:8000) and the **restarted** interviewer worker (Task 4, Step 10) are running.
2. In the app, book and prepare a round for the allow-listed account until it reads Ready, then open the live room. Leave the **instructions page open for at least 6 minutes** (longer than LiveKit's default 5-minute empty-room timeout), then continue to the checks and press **Enter interview**.
3. In the worker log (`/private/tmp/claude-501/-Users-salescode-Desktop-project-interviewiq/2c72efcc-51f2-4ab6-8c5f-b8cc838228fb/scratchpad/worker.log`, or wherever it was started) confirm, in this order: `interviewer stage job_received`, `room_joined`, `context_loaded`, `session_started` (all before you pressed Enter), then `hello`, `begin`, `first_audio` after it. The numbers after `hello` are the wait the candidate feels.
4. Confirm the API log shows `interviewer for session …: dispatched` at warm-up and **no second dispatch** at go-live.
5. If the worker log shows `room disconnected` / `process exiting` during the 6-minute wait, LiveKit closed the room under the waiting interviewer: go-live then dispatched a fresh one (still correct, just not early). Report it to the user; the follow-up is creating the room explicitly with a longer `empty_timeout` before dispatching.
6. Also try: leave the instructions page and close the tab: after 15 minutes the worker logs `no candidate came … leaving` and the session is still `PREP_READY`.

- [ ] **Step 2: Update the spec**

- Status line: `Status: implemented 2026-10-11 (see plan 2026-10-11-warm-interviewer.md).`
- §4.3 "Stale blueprint" bullet: replace with "**Stale blueprint:** after the hello the worker compares the current blueprint's id and version with the one it loaded (the reconcile job may re-prepare a round more than 30 minutes before its slot). If they differ it leaves without starting the round; the page's existing nudge re-dispatches an interviewer that loads the new blueprint. It does not reload in place because a new blueprint can change the interviewer's persona, and with it the voice, which a running voice session cannot swap."
- Add `## 10. Spike result` with the three facts recorded in Task 1, Step 2 and the Step 1 observations above (the measured `hello → begin → first_audio` milliseconds).
- Add a one-line known limit to §9: "The voice track is published only once the candidate has joined (LiveKit starts the session's audio output on the first participant), so a little start-up time remains after the hello."

- [ ] **Step 3: Remove the throwaway spike**

Run: `rm apps/api/scripts/dev/spike-livekit-dispatch.ts`

- [ ] **Step 4: Final report to the user**

State plainly: what was built; which tests were written but not run (all of them, per the standing rule, unless the user asked); the manual-join result with the measured milliseconds; the one deliberate deviation from the spec (stale blueprint: leave and re-dispatch); and whether LiveKit kept the room open under the waiting interviewer. Leave everything uncommitted.

---

## Self-review

**Spec coverage:** §4.1 web warm call → Task 5 Steps 3–4 and 6; wait for the interviewer, 15 s, "Your interviewer is joining…" → Task 5 Steps 5–6. §4.2 warm endpoint, dedupe, `startLive` guarded path, context for `PREP_READY`, contract → Tasks 1–3. §4.3 round starts at the hello, greeting waits, 15-minute exit → Task 4; stale blueprint → Task 4 (deviation, Task 6 updates the spec). §5 failure modes → Review Focus and the tests named there. §6 cost/abuse → the owner check, eligibility and per-session dedupe (Task 2). §7 measuring → `StageClock` (Task 4) and the API `interviewer for session …` log line (Task 2), plus the spike (Task 1) and the manual timing (Task 6). §8 testing → each task's tests. §9 later → recorded in the spec, not built.

**Placeholder scan:** none; every code step carries the code.

**Type consistency:** `hasDispatch` (Task 1) is the name used in Task 2; `warm` / `WarmResponse` / `{ warming }` (Task 2) match the route (Task 3), the OpenAPI `WarmLiveResponse` and the web `warmLive` / `WarmLiveResponse` (Task 5); `begun`, `_early`, `begin_when_candidate_arrives`, `blueprint_changed`, `StageClock`, `WAIT_FOR_CANDIDATE_S` are spelled the same in the tests, the implementation and the ad-hoc check; `AGENT_WAIT_MS` is exported in Task 5 Step 5 and imported by its test in Step 1.
