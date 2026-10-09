# Live Interview Wiring and the Live Run (Module 03, plan 3 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the room (plan 1) and the worker (plan 2) through the API: an allowlist that opens live interviews for the test account, explicit agent dispatch, the internal context and end endpoints, the candidate's end fallback, a sweep for stuck sessions, the web's "interviewer reconnecting" handling, and then the live run of the Salescode round.

**Architecture:** `LiveSessionService` gains a `LiveAvailability` policy (global flag or allowlisted user), a `LiveKitRoomAdmin` (LiveKit's Twirp API through the injectable `lib/http` fetch, so tests use `FakeFetch`) for dispatching the `interviewer` agent and checking it is present, and the context/end operations. The end state is stored on `interview_sessions` (`ended_reason`, `live_ended_at`, `duration_s` already exist; `live_summary` is new). The web calls the candidate end endpoint when the interviewer doesn't answer End, and nudges a re-dispatch while the interviewer is missing.

**Tech Stack:** Node 22, Express 5, TypeScript, Drizzle (Postgres) with additive migrations, zod, `livekit-server-sdk` (`AccessToken`), Vitest + supertest + PGlite + `FakeFetch`; web as in plan 1.

**Spec:** `docs/superpowers/specs/2026-10-08-live-interviewer-design.md` §8 (API), §5.6 (ending), §11 (failures), §13 phase 3. Builds on plans 1 and 2.

## Global Constraints

- **No commits.** Leave changes in the working tree.
- **Test runs:** the user's standing rule is no test runs unless they say so; ask once at the start of execution.
- **API conventions** (`apps/api/CLAUDE.md`): endpoints under `/api/v1`, errors `{ code, message }` with stable snake_case codes, outbound HTTP only through `lib/http.ts` with the injectable `fetch`, migrations additive and generated with `db:generate`, never log tokens or the internal key.
- **Contract:** every new endpoint and field goes into `packages/contracts/openapi.yaml`; regenerate web types with `pnpm --filter @interviewiq/web generate:types`. Never hand-write API DTO types on the web.
- **Internal endpoints** answer in snake_case (the Python worker consumes them); candidate endpoints in camelCase, like the rest of the candidate API.
- **The scoring consequences** of `ended_by_interviewer` (an attempt with a heavy penalty) belong to Module 04; this plan only records the reason.

## Review Focus

1. **The worker calls `end` twice** (a retry after a timeout that actually succeeded) → the second call returns the stored result with `already_ended: true` and changes nothing (Task 4 test).
2. **A resume while the interviewer is merely slow to join** → no second dispatch within 30 s of going live or of the last dispatch, so two interviewers never join one room (Task 2 test).
3. **LiveKit's API is down at go-live** → the candidate still gets a token and enters; the dispatch failure is logged and retried on resume (Task 2 test).
4. **The candidate's End fallback arrives after the interviewer already ended the session** → idempotent, no error shown (Task 5 test).
5. **A session stays `LIVE_IN_PROGRESS` because the worker died** → the sweep aborts it as `technical` only past 1.5× its duration plus 30 minutes, never a running one (Task 6 test).

---

### Task 1: Live availability (global flag or allowlist)

**Files:**
- Create: `apps/api/src/services/liveAvailability.ts`
- Create: `apps/api/test/services/liveAvailability.test.ts`
- Modify: `apps/api/src/config.ts`, `apps/api/src/container.ts`, `apps/api/src/services/interviewSessions.ts`, `apps/api/src/services/liveSessions.ts`, `apps/api/.env.example`

**Interfaces:**
- Produces: `LiveAvailability(globalOn: boolean, allowlist?: readonly string[])` with `isAvailableFor(userId): boolean`; config `blueprint.liveInterviewerAllowlist: string[]` from `LIVE_INTERVIEWER_ALLOWLIST` (comma-separated user ids).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { LiveAvailability } from "../../src/services/liveAvailability.js";
import { testConfig } from "../support/harness.js";

describe("LiveAvailability", () => {
  it("opens live interviews to everyone when the flag is on, else only to allowlisted users", () => {
    expect(new LiveAvailability(true).isAvailableFor("anyone")).toBe(true);
    const gated = new LiveAvailability(false, [" u1 ", "", "u2"]);
    expect(gated.isAvailableFor("u1")).toBe(true);
    expect(gated.isAvailableFor("u3")).toBe(false);
  });

  it("reads LIVE_INTERVIEWER_ALLOWLIST as comma-separated user ids", () => {
    expect(testConfig({ LIVE_INTERVIEWER_ALLOWLIST: "a, b,," }).blueprint.liveInterviewerAllowlist).toEqual(["a", "b"]);
    expect(testConfig().blueprint.liveInterviewerAllowlist).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && pnpm vitest run test/services/liveAvailability.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/services/liveAvailability.ts`:

```ts
/**
 * Who may enter a live interview (spec §8.1): everyone once LIVE_INTERVIEWER_AVAILABLE is on;
 * until then only the user ids in LIVE_INTERVIEWER_ALLOWLIST (the proof-of-concept test account).
 */
export class LiveAvailability {
  private readonly allow: Set<string>;

  constructor(
    private readonly globalOn: boolean,
    allowlist: readonly string[] = [],
  ) {
    this.allow = new Set(allowlist.map((id) => id.trim()).filter(Boolean));
  }

  isAvailableFor(userId: string): boolean {
    return this.globalOn || this.allow.has(userId);
  }
}
```

`src/config.ts`: below `LIVE_INTERVIEWER_AVAILABLE: bool(false),` add

```ts
  /** Comma-separated user ids that may go live while LIVE_INTERVIEWER_AVAILABLE is off (the POC test account). */
  LIVE_INTERVIEWER_ALLOWLIST: withDefault(""),
```

and in `toConfig`'s `blueprint` block add

```ts
      liveInterviewerAllowlist: e.LIVE_INTERVIEWER_ALLOWLIST.split(",").map((s) => s.trim()).filter(Boolean),
```

`src/services/interviewSessions.ts`: import `LiveAvailability`, change the last constructor parameter to `private readonly live: LiveAvailability = new LiveAvailability(false),` and replace both `{ liveAvailable: this.liveAvailable }` / `{ liveAvailable: this.liveAvailable, live }` uses with `this.live.isAvailableFor(candidateId)` in `listSessions` and `this.live.isAvailableFor(s.candidateId)` in `toResponse`.

`src/services/liveSessions.ts`: change `private readonly liveAvailable = false,` to `private readonly live: LiveAvailability = new LiveAvailability(false),` and `if (!this.liveAvailable)` to `if (!this.live.isAvailableFor(candidateId))`. (Task 2 adds more constructor parameters.)

`src/container.ts`: build one `const liveAvailability = new LiveAvailability(config.blueprint.liveInterviewerAvailable, config.blueprint.liveInterviewerAllowlist);` and pass it in place of `config.blueprint.liveInterviewerAvailable` to both services.

`.env.example`: below `LIVE_INTERVIEWER_AVAILABLE=false` add `LIVE_INTERVIEWER_ALLOWLIST=` with a comment `# user ids allowed to go live while the flag is off`.

Search the tests for direct constructions (`grep -rn "new InterviewSessionService\|new LiveSessionService" test`) and pass `new LiveAvailability(<old boolean>)` where a boolean was passed.

- [ ] **Step 4: Run the tests**

Run: `cd apps/api && pnpm vitest run test/services/liveAvailability.test.ts test/services/liveSessionService.test.ts test/routes/interviewSessionLiveController.test.ts test/routes/interviewSessionController.test.ts`
Expected: PASS.

---

### Task 2: Agent dispatch and presence (LiveKit room admin)

**Files:**
- Modify: `apps/api/src/integrations/livekit.ts`
- Modify: `apps/api/src/services/liveSessions.ts`, `apps/api/src/container.ts`
- Create: `apps/api/test/integrations/liveKitRoomAdmin.test.ts`
- Modify: `apps/api/test/routes/interviewSessionLiveController.test.ts`

**Interfaces:**
- Produces: `AgentRooms { dispatchAgent(sessionId): Promise<void>; hasAgent(sessionId): Promise<boolean> }`, `LiveKitRoomAdmin(url, apiKey, apiSecret, fetchImpl, agentName = "interviewer") implements AgentRooms`; `LiveSessionService(sessions, liveKit, prep, live, rooms, companies, log)` dispatching at go-live and re-dispatching on resume (`REDISPATCH_AFTER_MS = 30_000`).

- [ ] **Step 1: Write the failing tests**

`test/integrations/liveKitRoomAdmin.test.ts`:

```ts
import { decodeJwt } from "jose";
import { describe, expect, it } from "vitest";
import { LiveKitRoomAdmin } from "../../src/integrations/livekit.js";
import { FakeFetch, json } from "../support/fakeFetch.js";

const SID = "11111111-1111-1111-1111-111111111111";

describe("LiveKitRoomAdmin", () => {
  it("dispatches the interviewer into the session's room with the session id as metadata", async () => {
    const fake = new FakeFetch().on("POST", /AgentDispatchService\/CreateDispatch$/, {});
    await new LiveKitRoomAdmin("wss://x.livekit.cloud", "APIkey", "secret-secret-secret-secret-secret-1", fake.fetch).dispatchAgent(SID);
    const call = fake.callsTo(/CreateDispatch/)[0]!;
    expect(call.url).toBe("https://x.livekit.cloud/twirp/livekit.AgentDispatchService/CreateDispatch");
    expect(JSON.parse(call.body!)).toEqual({ room: `interview-${SID}`, agentName: "interviewer", metadata: JSON.stringify({ session_id: SID }) });
    const claims = decodeJwt(call.headers.authorization!.replace("Bearer ", ""));
    expect(claims.video).toEqual({ roomAdmin: true, room: `interview-${SID}` });
  });

  it("knows whether an agent is in the room", async () => {
    const fake = new FakeFetch().once("POST", /ListParticipants$/, { participants: [{ identity: "u1", kind: "STANDARD" }] })
      .once("POST", /ListParticipants$/, { participants: [{ identity: "agent-1", kind: "AGENT" }] });
    const admin = new LiveKitRoomAdmin("wss://x.livekit.cloud", "APIkey", "secret-secret-secret-secret-secret-1", fake.fetch);
    expect(await admin.hasAgent(SID)).toBe(false);
    expect(await admin.hasAgent(SID)).toBe(true);
  });
});
```

(Use the `RecordedCall` field names `FakeFetch` really records — `url`, `method`, `headers`, `body` — adjusting the property access if the recorder stores headers differently.)

In `test/routes/interviewSessionLiveController.test.ts`, add:

```ts
describe("agent dispatch", () => {
  it("dispatches the interviewer at go-live, and a failed dispatch still lets the candidate in", async () => {
    env.fetch.reset();
    env.fetch.on("POST", /CreateDispatch$/, json({}, 500));
    const user = await createUser(env);
    const s = await seedSession(env, user.id, jd, { status: "PREP_READY" });
    const res = await env.http.post(live(s.id)).set("Authorization", await bearer(env, user));
    expect(res.status).toBe(200);
    expect(env.fetch.callsTo(/CreateDispatch/)).toHaveLength(1);
  });

  it("re-dispatches on resume only when the room has no interviewer and enough time has passed", async () => {
    env.fetch.reset();
    env.fetch.on("POST", /CreateDispatch$/, {});
    env.fetch.once("POST", /ListParticipants$/, { participants: [] });
    const user = await createUser(env);
    const fresh = await seedSession(env, user.id, jd, { status: "LIVE_IN_PROGRESS", liveStartedAt: new Date() });
    await env.http.get(live(fresh.id)).set("Authorization", await bearer(env, user));
    expect(env.fetch.callsTo(/ListParticipants/)).toHaveLength(0);
    const old = await seedSession(env, user.id, jd, { status: "LIVE_IN_PROGRESS", liveStartedAt: new Date(Date.now() - 120_000) });
    await env.http.get(live(old.id)).set("Authorization", await bearer(env, user));
    expect(env.fetch.callsTo(/CreateDispatch/)).toHaveLength(1);
    await env.http.get(live(old.id)).set("Authorization", await bearer(env, user));
    expect(env.fetch.callsTo(/CreateDispatch/)).toHaveLength(1); // the last dispatch was under 30 s ago
  });
});
```

(Import `json` from `../support/fakeFetch.js`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && pnpm vitest run test/integrations/liveKitRoomAdmin.test.ts test/routes/interviewSessionLiveController.test.ts`
Expected: FAIL — `LiveKitRoomAdmin` missing; no dispatch calls.

- [ ] **Step 3: Implement the room admin**

Append to `src/integrations/livekit.ts` (and update the class comment above `LiveKitTokenService`: the API now dispatches the agent explicitly):

```ts
import { requestJson, type FetchLike } from "../lib/http.js";

export const INTERVIEWER_AGENT = "interviewer";

/** Room-level operations the live session service needs from LiveKit. */
export interface AgentRooms {
  dispatchAgent(sessionId: string): Promise<void>;
  hasAgent(sessionId: string): Promise<boolean>;
}

/**
 * LiveKit's server API (Twirp over HTTPS) through the injectable fetch: explicit dispatch of the
 * interviewer agent into `interview-{sessionId}` (spec §8.1), and whether an agent is in the room.
 */
export class LiveKitRoomAdmin implements AgentRooms {
  constructor(
    private readonly url: string,
    private readonly apiKey: string,
    private readonly apiSecret: string,
    private readonly fetchImpl: FetchLike,
    private readonly agentName = INTERVIEWER_AGENT,
  ) {}

  private base(): string {
    return this.url.replace(/^ws(s?):\/\//, "http$1://").replace(/\/+$/, "");
  }

  private async call(service: string, method: string, room: string, body: Record<string, unknown>): Promise<unknown> {
    const token = new AccessToken(this.apiKey, this.apiSecret, { ttl: 600 });
    token.addGrant({ roomAdmin: true, room });
    return requestJson(this.fetchImpl, {
      method: "POST",
      url: `${this.base()}/twirp/livekit.${service}/${method}`,
      headers: { Authorization: `Bearer ${await token.toJwt()}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      timeoutMs: 10_000,
    });
  }

  async dispatchAgent(sessionId: string): Promise<void> {
    const room = `interview-${sessionId}`;
    await this.call("AgentDispatchService", "CreateDispatch", room, {
      room, agentName: this.agentName, metadata: JSON.stringify({ session_id: sessionId }),
    });
  }

  async hasAgent(sessionId: string): Promise<boolean> {
    const room = `interview-${sessionId}`;
    const res = (await this.call("RoomService", "ListParticipants", room, { room })) as { participants?: { kind?: string | number }[] };
    return (res.participants ?? []).some((p) => p.kind === "AGENT" || p.kind === 4);
  }
}
```

(Put the `import` with the other imports at the top of the file.)

- [ ] **Step 4: Dispatch from the live session service**

In `src/services/liveSessions.ts`:

```ts
import type { CompanyRepository } from "../repositories/pg.js";
import type { AgentRooms } from "../integrations/livekit.js";
import type { Logger } from "../lib/logger.js";
import { errorMessage } from "../lib/errors.js";

/** No re-dispatch until the interviewer had this long to join after go-live (or after the last dispatch). */
export const REDISPATCH_AFTER_MS = 30_000;
```

Constructor:

```ts
  private readonly lastDispatch = new Map<string, number>();

  constructor(
    private readonly sessions: InterviewSessionRepository,
    private readonly liveKit: LiveKitTokenService,
    private readonly prep: BlueprintPrepService,
    private readonly live: LiveAvailability = new LiveAvailability(false),
    private readonly rooms: AgentRooms | null = null,
    private readonly companies: CompanyRepository | null = null,
    private readonly log: Logger | null = null,
  ) {}
```

In `startLive`, after `if (updated) await this.prep.recordSeen(updated);` add `if (updated) await this.dispatch(sessionId);`, and change the resume line to:

```ts
    if (s.status === "LIVE_IN_PROGRESS") {
      await this.ensureAgent(s);
      return this.connection(sessionId, candidateId, s.status);
    }
```

In `getLive`, before returning the connection for a live session, `await this.ensureAgent(s);`.

Add:

```ts
  private async dispatch(sessionId: string): Promise<void> {
    if (!this.rooms) return;
    this.lastDispatch.set(sessionId, Date.now());
    try {
      await this.rooms.dispatchAgent(sessionId);
    } catch (err) {
      this.log?.warn(`interviewer dispatch failed for session ${sessionId}: ${errorMessage(err)}`);
    }
  }

  /** On resume: dispatch again when the room has no interviewer (the worker crashed), never twice in 30 s. */
  private async ensureAgent(s: InterviewSessionRow): Promise<void> {
    if (!this.rooms) return;
    const now = Date.now();
    const since = Math.max(s.liveStartedAt?.getTime() ?? 0, this.lastDispatch.get(s.id) ?? 0);
    if (now - since < REDISPATCH_AFTER_MS) return;
    try {
      if (!(await this.rooms.hasAgent(s.id))) await this.dispatch(s.id);
    } catch (err) {
      this.log?.warn(`interviewer presence check failed for session ${s.id}: ${errorMessage(err)}`);
    }
  }
```

(Use the logger type and `errorMessage` helper the other services import — check `src/jobs/jobs.ts` for the exact paths.)

`src/container.ts`: `const roomAdmin = new LiveKitRoomAdmin(config.livekit.url, config.livekit.apiKey, config.livekit.apiSecret, fetchImpl);` and pass `liveAvailability, roomAdmin, repos.companies, log` to `LiveSessionService`.

- [ ] **Step 5: Run the tests**

Run: `cd apps/api && pnpm vitest run test/integrations test/routes/interviewSessionLiveController.test.ts test/services/liveSessionService.test.ts`
Expected: PASS.

---

### Task 3: `live_summary`, the session's `endReason`, and the contract

**Files:**
- Modify: `apps/api/src/db/pg/schema.ts`
- Create (generated): `apps/api/drizzle/0009_live_summary.sql`, `apps/api/drizzle/meta/0009_snapshot.json`, `apps/api/drizzle/meta/_journal.json` (updated)
- Modify: `apps/api/src/services/interviewSessions.ts`
- Modify: `packages/contracts/openapi.yaml`
- Modify (generated): `apps/web/lib/api-client/generated/schema.d.ts`
- Modify: `apps/api/test/routes/interviewSessionController.test.ts`

**Interfaces:**
- Produces: `LiveSummary` type and `interviewSessions.liveSummary` column; `InterviewSessionResponse.endReason: string | null`; contract schemas `LiveEndReason`, `LiveSummary`, `LiveEndRequest`, `LiveEndResult`, `LiveContext`, `CandidateLiveEndResult`, and the three new paths (Tasks 4 and 5 implement them).

- [ ] **Step 1: Add the column and generate the migration**

In `schema.ts`, above `interviewSessions`:

```ts
/** The live round's proctoring and conduct summary, written when it ends (spec §8.2). */
export interface LiveSummary {
  tab_changes: number;
  screen_changes_weighted: number;
  full_violations: number;
  conduct_incidents: number;
  ended_at?: string;
  interviewer_note?: string;
}
```

and after `endedReason: varchar("ended_reason", { length: 32 }),` add `liveSummary: jsonb("live_summary").$type<LiveSummary>(),`.

Run: `cd apps/api && pnpm db:generate --name live_summary`
Expected: `drizzle/0009_live_summary.sql` containing only `ALTER TABLE "interview_sessions" ADD COLUMN "live_summary" jsonb;`. If drizzle-kit proposes anything else, stop: the snapshot is out of step, and that must be fixed before continuing.

- [ ] **Step 2: Expose `endReason` and test it**

In `InterviewSessionResponse` add `/** How the live round ended (completed, ended_by_interviewer, candidate_ended, technical); null before it ends. */ endReason: string | null;` and in `toSessionResponse` add `endReason: s.endedReason ?? null,` after `liveAvailable`.

In `interviewSessionController.test.ts` add a test: seed a `COMPLETED` session with `endedReason: "ended_by_interviewer"`, GET it, and expect `res.body.endReason` to be `"ended_by_interviewer"`; a fresh booking has `endReason: null`. (Follow the file's existing seeding and auth helpers.)

- [ ] **Step 3: Update the contract**

In `packages/contracts/openapi.yaml`:
- `InterviewSession.properties` gains `endReason: { allOf: [{ $ref: "#/components/schemas/LiveEndReason" }], nullable: true, description: "How the live round ended; null before it ends." }` (add it to `required`).
- New schemas:

```yaml
    LiveEndReason:
      type: string
      enum: [completed, ended_by_interviewer, candidate_ended, technical]
    LiveSummary:
      type: object
      properties:
        tab_changes: { type: integer, minimum: 0 }
        screen_changes_weighted: { type: number, minimum: 0 }
        full_violations: { type: integer, minimum: 0 }
        conduct_incidents: { type: integer, minimum: 0 }
        ended_at: { type: string, format: date-time }
        interviewer_note: { type: string }
    LiveEndRequest:
      type: object
      required: [reason]
      properties:
        reason: { $ref: "#/components/schemas/LiveEndReason" }
        live_summary: { $ref: "#/components/schemas/LiveSummary" }
    LiveEndResult:
      type: object
      required: [status, ended_reason, already_ended]
      properties:
        status: { $ref: "#/components/schemas/SessionStatus" }
        ended_reason: { type: string, nullable: true }
        already_ended: { type: boolean }
    CandidateLiveEndResult:
      type: object
      required: [status, endReason, alreadyEnded]
      properties:
        status: { $ref: "#/components/schemas/SessionStatus" }
        endReason: { type: string, nullable: true }
        alreadyEnded: { type: boolean }
    LiveContext:
      type: object
      description: What the interviewer worker needs at the start of a live round. No contact details.
      required: [session_id, candidate_id, first_name, status, round, profile]
      properties:
        session_id: { type: string, format: uuid }
        candidate_id: { type: string, format: uuid }
        first_name: { type: string, nullable: true }
        status: { $ref: "#/components/schemas/SessionStatus" }
        round:
          type: object
          required: [company, company_name, role, level, round_type, duration_mins]
          properties:
            company: { type: string }
            company_name: { type: string, nullable: true }
            role: { type: string }
            level: { type: string }
            round_type: { $ref: "#/components/schemas/RoundType" }
            duration_mins: { type: integer }
        profile:
          type: object
          required: [headline, skills, projects]
          properties:
            headline: { type: string, nullable: true }
            skills: { type: array, items: { type: string } }
            projects: { type: array, items: { type: string } }
```

- New paths (next to the existing live and internal paths):

```yaml
  /api/v1/interviews/sessions/{sessionId}/live/end:
    parameters:
      - $ref: "#/components/parameters/SessionId"
    post:
      operationId: endLiveInterviewSession
      tags: [interview-sessions]
      summary: End the live round from the candidate's side (the fallback when the interviewer doesn't answer End).
      description: Idempotent; a round that already ended returns its stored result with alreadyEnded true.
      security: [{ bearerAuth: [] }]
      responses:
        "200": { description: The end result., content: { application/json: { schema: { $ref: "#/components/schemas/CandidateLiveEndResult" } } } }
        "401": { $ref: "#/components/responses/Unauthorized" }
        "404": { $ref: "#/components/responses/NotFound" }
        "409": { description: "`session_not_live`.", content: { application/json: { schema: { $ref: "#/components/schemas/ApiError" } } } }
  /api/v1/internal/live/sessions/{sessionId}/context:
    parameters:
      - $ref: "#/components/parameters/SessionId"
    get:
      operationId: getLiveContext
      tags: [internal-live]
      summary: The round and a minimal profile for the interviewer worker.
      security: [{ internalApiKey: [] }]
      responses:
        "200": { description: The context., content: { application/json: { schema: { $ref: "#/components/schemas/LiveContext" } } } }
        "401": { $ref: "#/components/responses/Unauthorized" }
        "404": { $ref: "#/components/responses/NotFound" }
        "409": { description: "`session_not_live`.", content: { application/json: { schema: { $ref: "#/components/schemas/ApiError" } } } }
  /api/v1/internal/live/sessions/{sessionId}/end:
    parameters:
      - $ref: "#/components/parameters/SessionId"
    post:
      operationId: endLiveSessionInternal
      tags: [internal-live]
      summary: The interviewer worker ends the live round (idempotent).
      security: [{ internalApiKey: [] }]
      requestBody:
        required: true
        content: { application/json: { schema: { $ref: "#/components/schemas/LiveEndRequest" } } }
      responses:
        "200": { description: The end result., content: { application/json: { schema: { $ref: "#/components/schemas/LiveEndResult" } } } }
        "400": { description: "`live_end_bad_request`.", content: { application/json: { schema: { $ref: "#/components/schemas/ApiError" } } } }
        "401": { $ref: "#/components/responses/Unauthorized" }
        "404": { $ref: "#/components/responses/NotFound" }
        "409": { description: "`session_not_live`.", content: { application/json: { schema: { $ref: "#/components/schemas/ApiError" } } } }
```

Also correct the go-live description: "Refused with 409 `live_unavailable` while the live interviewer is unavailable to this user (`InterviewSession.liveAvailable` is false). Going live dispatches the interviewer agent into the room."

Run: `pnpm --filter @interviewiq/web generate:types`
Expected: `apps/web/lib/api-client/generated/schema.d.ts` gains the new schemas and `endReason`.

- [ ] **Step 4: Run the tests**

Run: `cd apps/api && pnpm vitest run test/routes/interviewSessionController.test.ts test/db && pnpm typecheck`, then `cd apps/web && pnpm typecheck`
Expected: PASS (web fixtures that build an `InterviewSession` by hand may need `endReason: null` added; add it where the typecheck asks).

---

### Task 4: Internal context and end endpoints

**Files:**
- Modify: `apps/api/src/services/blueprintPrep.ts` (add `liveContext`)
- Modify: `apps/api/src/services/liveSessions.ts` (add `context`, `endFromInterviewer`, `endFromCandidate`)
- Modify: `apps/api/src/routes/internal.ts`
- Create: `apps/api/test/routes/internalLive.test.ts`

**Interfaces:**
- Produces: `BlueprintPrepService.liveContext(session) -> { firstName, profile: { headline, skills, projects } }`; `LiveSessionService.context(sessionId)`, `endFromInterviewer(sessionId, reason, summary)`, `endFromCandidate(candidateId, sessionId)`; routes `GET /api/v1/internal/live/sessions/:sessionId/context`, `POST /api/v1/internal/live/sessions/:sessionId/end`.

- [ ] **Step 1: Write the failing test**

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { JobDescriptionRow } from "../../src/db/pg/schema.js";
import { createTestEnv, createUser, TEST_INTERNAL_KEY, type TestEnv } from "../support/harness.js";
import { seedCompany, seedJd, seedSession } from "./helpers.js";

let env: TestEnv;
let jd: JobDescriptionRow;
const ctx = (id: string) => `/api/v1/internal/live/sessions/${id}/context`;
const end = (id: string) => `/api/v1/internal/live/sessions/${id}/end`;

beforeAll(async () => {
  env = await createTestEnv();
  await seedCompany(env, "google", "Google");
  jd = await seedJd(env);
});
afterAll(() => env.close());

describe("internal live endpoints", () => {
  it("gives the worker the round and a minimal profile, only while live", async () => {
    const user = await createUser(env, { name: "Asha Rao" });
    const s = await seedSession(env, user.id, jd, { status: "LIVE_IN_PROGRESS", liveStartedAt: new Date(),
      prepBriefing: { interviewer_name: "Siddharth", interviewer_style: "warm", format: "coding", duration_mins: 45 } });
    const res = await env.http.get(ctx(s.id)).set("X-Internal-Api-Key", TEST_INTERNAL_KEY);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ session_id: s.id, candidate_id: user.id, first_name: "Asha", status: "LIVE_IN_PROGRESS",
      round: { company: "google", company_name: "Google", round_type: "dsa", duration_mins: 45 } });
    expect(res.body.profile).toEqual({ headline: expect.anything(), skills: expect.any(Array), projects: expect.any(Array) });
    expect(JSON.stringify(res.body)).not.toContain("@");

    const ready = await seedSession(env, user.id, jd, { status: "PREP_READY" });
    expect((await env.http.get(ctx(ready.id)).set("X-Internal-Api-Key", TEST_INTERNAL_KEY)).body.code).toBe("session_not_live");
    expect((await env.http.get(ctx(s.id))).status).toBe(401);
  });

  it("ends a live round once, storing the reason, duration and summary", async () => {
    const user = await createUser(env);
    const s = await seedSession(env, user.id, jd, { status: "LIVE_IN_PROGRESS", liveStartedAt: new Date(Date.now() - 600_000) });
    const body = { reason: "ended_by_interviewer", live_summary: { tab_changes: 3, screen_changes_weighted: 0.5, full_violations: 3, conduct_incidents: 0 } };
    const first = await env.http.post(end(s.id)).set("X-Internal-Api-Key", TEST_INTERNAL_KEY).send(body);
    expect(first.body).toEqual({ status: "COMPLETED", ended_reason: "ended_by_interviewer", already_ended: false });
    const row = (await env.c.repos.sessions.findById(s.id))!;
    expect(row.endedReason).toBe("ended_by_interviewer");
    expect(row.liveSummary).toMatchObject({ tab_changes: 3, full_violations: 3 });
    expect(row.durationS).toBeGreaterThanOrEqual(599);
    const again = await env.http.post(end(s.id)).set("X-Internal-Api-Key", TEST_INTERNAL_KEY).send({ reason: "completed" });
    expect(again.body).toEqual({ status: "COMPLETED", ended_reason: "ended_by_interviewer", already_ended: true });
  });

  it("ends a technical failure as ABORTED_TECHNICAL and rejects bad bodies", async () => {
    const user = await createUser(env);
    const s = await seedSession(env, user.id, jd, { status: "LIVE_IN_PROGRESS", liveStartedAt: new Date() });
    const res = await env.http.post(end(s.id)).set("X-Internal-Api-Key", TEST_INTERNAL_KEY).send({ reason: "technical", live_summary: {} });
    expect(res.body.status).toBe("ABORTED_TECHNICAL");
    const bad = await env.http.post(end(s.id)).set("X-Internal-Api-Key", TEST_INTERNAL_KEY).send({ reason: "bored" });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("live_end_bad_request");
  });
});
```

(If `createUser` takes no `name` option, set the name through the user repository after creating it.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && pnpm vitest run test/routes/internalLive.test.ts`
Expected: FAIL — 404s.

- [ ] **Step 3: Implement**

`blueprintPrep.ts`, inside `BlueprintPrepService`:

```ts
  /** What the live interviewer needs about the candidate (spec §8.2): a first name and the profile's skills,
   *  headline and project names. No contact details. */
  async liveContext(session: InterviewSessionRow): Promise<{ firstName: string | null; profile: { headline: string | null; skills: string[]; projects: string[] } }> {
    const [profile, fragmentRows, user] = await Promise.all([
      this.d.candidateProfiles.getProfile(session.candidateId),
      this.d.fragments.findByUserId(session.candidateId),
      this.d.users.findById(session.candidateId),
    ]);
    const fragments = new Map(fragmentRows.filter((f) => isObject(f.data)).map((f) => [f.source as string, f.data]));
    const p = profileProjection(profile, fragments);
    return {
      firstName: user?.name?.trim().split(/\s+/)[0] || null,
      profile: { headline: p.headline, skills: p.skills, projects: p.projects.map((x) => x.name) },
    };
  }
```

`liveSessions.ts`:

```ts
const END_REASONS = ["completed", "ended_by_interviewer", "candidate_ended", "technical"] as const;
export type LiveEndReason = (typeof END_REASONS)[number];

export const LiveEndBody = z.object({
  reason: z.enum(END_REASONS),
  live_summary: z.object({
    tab_changes: z.number().int().min(0).default(0),
    screen_changes_weighted: z.number().min(0).default(0),
    full_violations: z.number().int().min(0).default(0),
    conduct_incidents: z.number().int().min(0).default(0),
    ended_at: z.string().max(64).optional(),
    interviewer_note: z.string().max(2000).optional(),
  }).default({ tab_changes: 0, screen_changes_weighted: 0, full_violations: 0, conduct_incidents: 0 }),
});
```

Methods:

```ts
  async context(sessionId: string) {
    const s = await this.sessions.findById(sessionId);
    if (!s) throw InterviewSessionError.notFound();
    if (s.status !== "LIVE_IN_PROGRESS") throw InterviewSessionError.conflict("session_not_live", "the session is not live");
    const [{ firstName, profile }, company] = await Promise.all([this.prep.liveContext(s), this.companies?.findBySlug(s.company) ?? null]);
    return {
      session_id: s.id, candidate_id: s.candidateId, first_name: firstName, status: s.status,
      round: { company: s.company, company_name: company?.name ?? null, role: s.role, level: s.level, round_type: s.roundType,
               duration_mins: s.prepBriefing?.duration_mins ?? 60 },
      profile,
    };
  }

  async endFromInterviewer(sessionId: string, reason: LiveEndReason, summary: LiveSummary) {
    const s = await this.sessions.findById(sessionId);
    if (!s) throw InterviewSessionError.notFound();
    const r = await this.end(s, reason, summary);
    return { status: r.status, ended_reason: r.endedReason, already_ended: r.alreadyEnded };
  }

  async endFromCandidate(candidateId: string, sessionId: string) {
    return this.end(await this.requireOwned(candidateId, sessionId), "candidate_ended", null);
  }

  private async end(s: InterviewSessionRow, reason: LiveEndReason, summary: LiveSummary | null) {
    if (s.status === "COMPLETED" || s.status === "ABORTED_TECHNICAL") {
      return { status: s.status, endedReason: s.endedReason, alreadyEnded: true };
    }
    if (s.status !== "LIVE_IN_PROGRESS") throw InterviewSessionError.conflict("session_not_live", "the session is not live");
    const now = new Date();
    const to: SessionStatus = reason === "technical" ? "ABORTED_TECHNICAL" : "COMPLETED";
    const updated = await this.sessions.transitionStatus(s.id, "LIVE_IN_PROGRESS", to, {
      liveEndedAt: now, endedReason: reason, liveSummary: summary,
      durationS: s.liveStartedAt ? Math.round((now.getTime() - s.liveStartedAt.getTime()) / 1000) : null,
    });
    if (!updated) {
      const latest = (await this.sessions.findById(s.id))!;
      return { status: latest.status, endedReason: latest.endedReason, alreadyEnded: true };
    }
    return { status: to, endedReason: reason, alreadyEnded: false };
  }
```

(Import `z` from `zod`, `LiveSummary` from the schema, `SessionStatus` from `../domain/enums.js`.)

`routes/internal.ts`, inside `internalRouter` after the existing routes:

```ts
  /** The live interviewer worker: the round and a minimal profile at the start (spec §8.2). */
  r.get("/live/sessions/:sessionId/context", async (req, res) => {
    res.json(await c.liveSessions.context(uuidParam(req, "sessionId")));
  });

  /** The live interviewer worker ends the round (idempotent). */
  r.post("/live/sessions/:sessionId/end", async (req, res) => {
    const parsed = LiveEndBody.safeParse(req.body);
    if (!parsed.success) throw new InvalidArgumentError(parsed.error.issues[0]?.message ?? "invalid body");
    res.json(await c.liveSessions.endFromInterviewer(uuidParam(req, "sessionId"), parsed.data.reason, parsed.data.live_summary));
  });

  r.use(routerErrors((err) => (err instanceof InvalidArgumentError ? { status: 400, code: "live_end_bad_request", message: err.message } : undefined)));
```

(Import `uuidParam`, `routerErrors` from `../http/support.js`, `InvalidArgumentError` from `../lib/errors.js`, `LiveEndBody` from `../services/liveSessions.js`. Confirm `InterviewSessionError` (an `ApiError`) reaches the global error handler as `{ code, message }`, as it does for the candidate routes.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && pnpm vitest run test/routes/internalLive.test.ts`
Expected: PASS (3 tests).

---

### Task 5: The candidate's End fallback

**Files:**
- Modify: `apps/api/src/routes/interviews.ts`
- Modify: `apps/api/test/routes/interviewSessionLiveController.test.ts`
- Modify: `apps/web/lib/constants/interview/index.ts`, `apps/web/features/interview/api.ts`, `apps/web/features/interview/types.ts`
- Modify: `apps/web/features/interview-live/session/LiveSessionProvider.tsx`, `LiveSessionProvider.test.tsx`

**Interfaces:**
- Produces: `POST /api/v1/interviews/sessions/:sessionId/live/end` → `{ status, endReason, alreadyEnded }`; web `INTERVIEW_ENDPOINTS.liveEnd(id)`, `endLive(id): Promise<CandidateLiveEndResult>`, type `CandidateLiveEndResult` (from the generated schema).

- [ ] **Step 1: Write the failing tests**

API (append to `interviewSessionLiveController.test.ts`):

```ts
describe("POST /sessions/:id/live/end (candidate fallback)", () => {
  it("ends the candidate's live round and is idempotent", async () => {
    const user = await createUser(env);
    const s = await seedSession(env, user.id, jd, { status: "LIVE_IN_PROGRESS", liveStartedAt: new Date() });
    const path = `${live(s.id)}/end`;
    const first = await env.http.post(path).set("Authorization", await bearer(env, user));
    expect(first.body).toEqual({ status: "COMPLETED", endReason: "candidate_ended", alreadyEnded: false });
    const again = await env.http.post(path).set("Authorization", await bearer(env, user));
    expect(again.body).toEqual({ status: "COMPLETED", endReason: "candidate_ended", alreadyEnded: true });
    const other = await createUser(env);
    expect((await env.http.post(path).set("Authorization", await bearer(env, other))).status).toBe(404);
  });
});
```

Web (in `LiveSessionProvider.test.tsx`), mock the API module at the top:

```tsx
const api = vi.hoisted(() => ({ endLive: vi.fn(async () => ({ status: 'COMPLETED', endReason: 'candidate_ended', alreadyEnded: false })) }))
vi.mock('@/features/interview/api', () => api)
```

and extend the "requestEnd … ends locally" test: after advancing the timer, `expect(api.endLive).toHaveBeenCalledWith('s1')`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/api && pnpm vitest run test/routes/interviewSessionLiveController.test.ts` and `cd apps/web && pnpm vitest run features/interview-live/session/LiveSessionProvider.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

`routes/interviews.ts`, after the GET live route:

```ts
  /** The candidate ends the live round: the fallback when the interviewer doesn't answer End (idempotent). */
  r.post("/sessions/:sessionId/live/end", async (req, res) => {
    res.json(await c.liveSessions.endFromCandidate(userId(req), uuidParam(req, "sessionId")));
  });
```

Web `lib/constants/interview/index.ts`: in the endpoints object add `liveEnd: (id: string) => \`${SESSIONS}/${id}/live/end\`,`.

`features/interview/types.ts`: `export type CandidateLiveEndResult = components["schemas"]["CandidateLiveEndResult"];` (follow the file's existing import of `components`).

`features/interview/api.ts`:

```ts
/** POST /api/v1/interviews/sessions/{id}/live/end — end the live round when the interviewer didn't answer End (idempotent). */
export function endLive(id: string): Promise<CandidateLiveEndResult> {
  return apiFetch<CandidateLiveEndResult>(INTERVIEW_ENDPOINTS.liveEnd(id), { method: "POST" });
}
```

`LiveSessionProvider.tsx`: destructure `sessionId` (`export function LiveSessionProvider({ sessionId, session, children }: …)`), import `endLive` and `isMockMode`, and in `requestEnd`'s timeout, before dispatching `ENDED`:

```ts
      // The interviewer never answered: record the end in the API ourselves (not in local mock mode).
      if (!isMockMode()) void endLive(sessionId).catch(() => {})
```

(add `sessionId` to the `useCallback` dependencies).

- [ ] **Step 4: Run the tests to verify they pass**

Run the two commands from Step 2.
Expected: PASS.

---

### Task 6: Sweep stuck live sessions

**Files:**
- Modify: `apps/api/src/repositories/pg.ts` (add `findLiveStartedBefore`)
- Modify: `apps/api/src/jobs/jobs.ts` (add `LiveSessionSweepJob`)
- Modify: `apps/api/src/container.ts` (`jobs.liveSweep`), `apps/api/src/index.ts` (schedule)
- Create: `apps/api/test/jobs/liveSessionSweep.test.ts`

**Interfaces:**
- Produces: `InterviewSessionRepository.findLiveStartedBefore(before: Date)`; `LiveSessionSweepJob(sessions, log, clock = Date.now)` with `tick(): Promise<number>` (sessions swept); constants `SWEEP_GRACE_MINUTES = 30`, `CEILING_FACTOR = 1.5`.

- [ ] **Step 1: Write the failing test**

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LiveSessionSweepJob } from "../../src/jobs/jobs.js";
import { createTestEnv, createUser, type TestEnv } from "../support/harness.js";
import { seedCompany, seedJd, seedSession } from "../routes/helpers.js";

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
  await seedCompany(env, "google", "Google");
});
afterAll(() => env.close());

describe("LiveSessionSweepJob", () => {
  it("aborts live sessions only past 1.5x their duration plus 30 minutes", async () => {
    const jd = await seedJd(env);
    const user = await createUser(env);
    const now = Date.now();
    const briefing = { interviewer_name: "S", interviewer_style: "w", format: "coding", duration_mins: 60 };
    const stuck = await seedSession(env, user.id, jd, { status: "LIVE_IN_PROGRESS", liveStartedAt: new Date(now - 121 * 60_000), prepBriefing: briefing });
    const running = await seedSession(env, user.id, jd, { status: "LIVE_IN_PROGRESS", liveStartedAt: new Date(now - 100 * 60_000), prepBriefing: briefing });
    const job = new LiveSessionSweepJob(env.c.repos.sessions, { info: () => {}, warn: () => {} } as never, () => now);
    expect(await job.tick()).toBe(1);
    expect((await env.c.repos.sessions.findById(stuck.id))!).toMatchObject({ status: "ABORTED_TECHNICAL", endedReason: "technical" });
    expect((await env.c.repos.sessions.findById(running.id))!.status).toBe("LIVE_IN_PROGRESS");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && pnpm vitest run test/jobs/liveSessionSweep.test.ts`
Expected: FAIL — `LiveSessionSweepJob` missing.

- [ ] **Step 3: Implement**

`repositories/pg.ts`, in `InterviewSessionRepository`:

```ts
  /** Live sessions that went live before `before` — the stuck-session sweep's candidates. */
  findLiveStartedBefore(before: Date): Promise<InterviewSessionRow[]> {
    return this.db
      .select()
      .from(interviewSessions)
      .where(and(eq(interviewSessions.status, "LIVE_IN_PROGRESS"), lt(interviewSessions.liveStartedAt, before)));
  }
```

(import `lt` from `drizzle-orm` with the others.)

`jobs/jobs.ts`:

```ts
export const SWEEP_GRACE_MINUTES = 30;
export const CEILING_FACTOR = 1.5;

/** Backstop for a worker that died without ending its session (spec §8.4): a session still live past
 *  1.5x its duration plus 30 minutes is aborted as technical. */
export class LiveSessionSweepJob {
  constructor(
    private readonly sessions: InterviewSessionRepository,
    private readonly log: Logger,
    private readonly clock: () => number = Date.now,
  ) {}

  async tick(): Promise<number> {
    const now = this.clock();
    let swept = 0;
    for (const s of await this.sessions.findLiveStartedBefore(new Date(now - SWEEP_GRACE_MINUTES * 60_000))) {
      const minutes = s.prepBriefing?.duration_mins ?? 60;
      const deadline = (s.liveStartedAt?.getTime() ?? now) + (CEILING_FACTOR * minutes + SWEEP_GRACE_MINUTES) * 60_000;
      if (now < deadline) continue;
      const row = await this.sessions.transitionStatus(s.id, "LIVE_IN_PROGRESS", "ABORTED_TECHNICAL", {
        liveEndedAt: new Date(now), endedReason: "technical",
      });
      if (row) swept++;
    }
    if (swept) this.log.info(`Live sweep: aborted ${swept} stuck live session(s)`);
    return swept;
  }
}
```

`container.ts` `jobs`: `liveSweep: new LiveSessionSweepJob(repos.sessions, log),`.

`index.ts`, inside `if (config.schedulerEnabled)`'s `tasks.push(…)`:

```ts
      fixedDelay("live-sweep", async () => { await c.jobs.liveSweep.tick(); }, { initialDelayMs: 60_000, delayMs: 5 * 60_000 }, log),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/api && pnpm vitest run test/jobs/liveSessionSweep.test.ts && pnpm typecheck`
Expected: PASS.

---

### Task 7: The room handles a missing interviewer

**Files:**
- Create: `apps/web/features/interview-live/session/useInterviewerPresence.ts`
- Create: `apps/web/features/interview-live/session/useInterviewerPresence.test.tsx`
- Modify: `apps/web/app/(app)/interviews/[sessionId]/live/_components/LiveView.tsx`
- Modify: `apps/web/features/interview-live/proctor/ProctorBars.tsx`

**Interfaces:**
- Produces: `useInterviewerPresence(agentState: AgentState, sessionId: string, nudge: (id: string) => Promise<unknown>): 'present' | 'joining' | 'reconnecting'`, `ABSENT_NOTICE_MS = 10_000`, `NUDGE_EVERY_MS = 30_000`; `ProctorBars` gains a `presence` prop.

- [ ] **Step 1: Write the failing test**

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { ABSENT_NOTICE_MS, NUDGE_EVERY_MS, useInterviewerPresence } from './useInterviewerPresence'
import type { AgentState } from './types'

afterEach(() => { vi.useRealTimers() })

describe('useInterviewerPresence', () => {
  it('says "joining" after 10 s without an interviewer, "reconnecting" once one left, and nudges the API every 30 s', () => {
    vi.useFakeTimers()
    const nudge = vi.fn(async () => ({}))
    const { result, rerender } = renderHook(({ s }: { s: AgentState }) => useInterviewerPresence(s, 's1', nudge), { initialProps: { s: 'absent' } })
    expect(result.current).toBe('present')
    act(() => { vi.advanceTimersByTime(ABSENT_NOTICE_MS) })
    expect(result.current).toBe('joining')
    act(() => { vi.advanceTimersByTime(NUDGE_EVERY_MS) })
    expect(nudge).toHaveBeenCalledWith('s1')
    rerender({ s: 'listening' })
    expect(result.current).toBe('present')
    rerender({ s: 'absent' })
    act(() => { vi.advanceTimersByTime(ABSENT_NOTICE_MS) })
    expect(result.current).toBe('reconnecting')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && pnpm vitest run features/interview-live/session/useInterviewerPresence.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
'use client'
import { useEffect, useRef, useState } from 'react'
import type { AgentState } from './types'

export const ABSENT_NOTICE_MS = 10_000
export const NUDGE_EVERY_MS = 30_000

export type Presence = 'present' | 'joining' | 'reconnecting'

/** Spec §11: after 10 s without the interviewer the room says so, and every 30 s it nudges the API
 * (GET live), which re-dispatches the interviewer when the room is empty. */
export function useInterviewerPresence(agentState: AgentState, sessionId: string, nudge: (id: string) => Promise<unknown>): Presence {
  const [notice, setNotice] = useState<Exclude<Presence, 'present'> | null>(null)
  const seen = useRef(false)
  const absent = agentState === 'absent'

  useEffect(() => {
    if (!absent) {
      seen.current = true
      return
    }
    const kind = seen.current ? 'reconnecting' : 'joining'
    const show = setTimeout(() => setNotice(kind), ABSENT_NOTICE_MS)
    const poke = setInterval(() => { void nudge(sessionId).catch(() => {}) }, NUDGE_EVERY_MS)
    return () => {
      clearTimeout(show)
      clearInterval(poke)
      setNotice(null)
    }
  }, [absent, sessionId, nudge])

  return absent && notice ? notice : 'present'
}
```

`ProctorBars.tsx`: add a `presence?: 'present' | 'joining' | 'reconnecting'` prop and, first among the bars:

```tsx
      {presence && presence !== 'present' ? (
        <div role="status" className="flex flex-none items-center gap-3 border-b border-line-2 bg-panel px-4 py-2 text-[13px]">
          <StatusDot state="live" srLabel="Waiting" />
          <span>{presence === 'joining' ? 'Connecting to your interviewer…' : 'Your interviewer is reconnecting…'}</span>
        </div>
      ) : null}
```

`LiveView.tsx`: destructure `sessionId` (`export function LiveView({ sessionId, meta }: …)`), import `getLive` from `@/features/interview/api` and the hook, add `const presence = useInterviewerPresence(agentState, sessionId, getLive)`, and pass `presence={presence}` to `ProctorBars`.

- [ ] **Step 4: Run the tests**

Run: `cd apps/web && pnpm vitest run features/interview-live "app/(app)/interviews/[sessionId]/live"`
Expected: PASS (the LiveView test mocks nothing from `@/features/interview/api`; the mock session reports `listening` at once, so no nudge fires).

---

### Task 8: Configuration, the full check, and the live run

**Files:**
- Create: `apps/api/scripts/dev/user-id.ts`
- Modify: `apps/api/CLAUDE.md` (commands), `docs/superpowers/specs/2026-10-08-live-interviewer-design.md` (§8.4: `ended_reason` already existed; only `live_summary` was added)

- [ ] **Step 1: A helper to find the test account's user id**

```ts
// Prints the user id for an email (dev only): pnpm exec tsx --env-file=.env scripts/dev/user-id.ts <email>
import { loadConfig } from "../../src/config.js";
import { createPool, createDatabase } from "../../src/db/pg/client.js";
import { UserRepository } from "../../src/repositories/pg.js";

const email = process.argv[2];
if (!email) throw new Error("usage: user-id.ts <email>");
const config = loadConfig();
const pool = createPool(config);
const repo = new UserRepository(createDatabase(pool));
const user = await repo.findByEmailIgnoreCase(email);
console.log(user ? user.id : `no user with email ${email}`);
await pool.end();
```

(Use the real names of the pool/database constructors and the email lookup in `src/db/pg/client.ts` and `UserRepository`; check `scripts/dev/seed-fit-personas.ts` for how the existing dev scripts connect.) Add the command to the Commands block in `apps/api/CLAUDE.md`.

- [ ] **Step 2: Run every suite and typecheck**

Run:
- `cd apps/api && pnpm vitest run && pnpm typecheck`
- `cd apps/web && pnpm vitest run && pnpm typecheck && pnpm lint`
- `cd apps/ai-service && .venv/bin/python -m pytest -q`

Expected: all PASS.

- [ ] **Step 3: Configure the test run**

- `apps/api/.env`: `LIVE_INTERVIEWER_ALLOWLIST=<the id printed by user-id.ts for the test account>` (leave `LIVE_INTERVIEWER_AVAILABLE=false`).
- `apps/ai-service/.env`: `OPENROUTER_API_KEY` set (done by the user), `DEEPGRAM_API_KEY`, `LIVEKIT_*`, `API_BASE_URL` pointing at the local API (`http://localhost:8080`), `INTERNAL_API_KEY` equal to the API's.
- The Salescode round: the session `cceda82c-5e3b-4db5-b104-f8fb856146f9` (or any of the test account's Salescode SDE-1 round-1 sessions) must be `PREP_READY` with a current blueprint. If it isn't (already used, cancelled, or the slot passed), book the round again from the UI and wait for prep to finish.

- [ ] **Step 4: Start the stack (no Docker)**

- `pnpm --filter @interviewiq/api dev`
- `pnpm --filter @interviewiq/web dev`
- `pnpm --filter @interviewiq/ai-service dev`
- `pnpm --filter @interviewiq/ai-service dev:interviewer` (the worker registers with LiveKit Cloud as `interviewer`)

- [ ] **Step 5: The live run (the user takes the round)**

Open the session's page, Start → pre-join → checks (share the entire screen) → Enter. Take the round by voice and code. Exercise: ask for constraints; ask for the answer; get stuck; take a hint; Ask about a highlighted line; draw on the whiteboard and refer to it; switch tabs once; run past a question's time and ask for more; end with End.

- [ ] **Step 6: Check against the spec's success criteria and replay the trace**

Run: `cd apps/ai-service && .venv/bin/python -m app.interviewer.trace <session_id>`

Confirm and report:
- the round followed the arc; each question moved on near its timebox and extra time was refused;
- stuck, wrong path and asking for the answer got the playbook's reaction; the tab switch was mentioned;
- every interviewer turn has a decision in the trace, and no `blocked` line shows an example or a solution being spoken;
- the median of `first audio` across turns is ≤ 1.5 s (spec §1);
- the session in the API is `COMPLETED` with `endReason: "candidate_ended"` and a `live_summary`.

Write the findings, including what felt unnatural, into the run report for the user.
