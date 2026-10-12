## Task 12: Admin research proxy router

**Files:**
- Create: `apps/api/src/routes/research.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/test/routes/adminResearchController.test.ts`

**Interfaces:**
- Consumes: the `AiServiceClient` research methods (Task 11).
- Produces these routes under `/api/v1/admin/research` (admin only, snake_case passthrough):

  | Method | Path | Notes |
  |---|---|---|
  | `POST` | `/runs` | Body `{scope, companyIds?, mode?}`; forwarded as `{scope, company_ids, mode?, requested_by: <admin id>}`. Returns 201. |
  | `GET` | `/runs?limit` | Limit clamped to 1–100 |
  | `GET` | `/runs/:runId` | |
  | `POST` | `/runs/:runId/pause\|resume\|stop` | |
  | `PATCH` | `/runs/:runId/budget` | `{exaCap?, llmCap?}` → `{exa_cap?, llm_cap?}` |
  | `GET` | `/runs/:runId/events?afterSeq&beforeSeq&limit&level&companyId&node&type&spanId&q` | Query mapped to snake_case |
  | `GET` | `/runs/:runId/spans?companyId` | |
  | `GET` | `/spans/:spanId` | |

  Errors:
  - 400 `invalid_run_id` / `invalid_span_id` for anything other than a 32-character hex ID.
  - 400 `no_companies`, `invalid_mode` and `invalid_budget` from local validation.
  - Upstream 400/404/409/503 `{code, message}` forwarded as-is; an upstream 422 becomes 400 `invalid_request`.
  - Anything else upstream becomes 502 `ai_service_unreachable`.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/routes/adminResearchController.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { UserRow } from "../../src/db/pg/schema.js";
import { json } from "../support/fakeFetch.js";
import { bearer, createUser, createTestEnv, TEST_INTERNAL_KEY, type TestEnv } from "../support/harness.js";
import { AI, aiCalls } from "./helpers.js";

const BASE = "/api/v1/admin/research";
const RUN = "a".repeat(32);
const SPAN = "b".repeat(32);

describe("admin research proxies", () => {
  let env: TestEnv;
  let adminUser: UserRow;
  let admin: string;
  beforeAll(async () => {
    env = await createTestEnv();
    adminUser = await createUser(env, { role: "ADMIN" });
    admin = await bearer(env, adminUser);
  });
  afterAll(() => env.close());
  beforeEach(() => env.fetch.reset());

  it("POST /runs forwards scope, ids, mode and the admin as requested_by (201 passthrough)", async () => {
    env.fetch.on("POST", `${AI}/research/runs`, () => json({ run_id: RUN, status: "queued" }, 201));
    const res = await env.http.post(`${BASE}/runs`).set("Authorization", admin)
      .send({ scope: "selected", companyIds: ["c1", 7], mode: "replay" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ run_id: RUN, status: "queued" });
    const [call] = aiCalls(env);
    expect(call!.json).toEqual({ scope: "selected", company_ids: ["c1"], mode: "replay", requested_by: adminUser.id });
    expect(call!.headers["x-internal-api-key"]).toBe(TEST_INTERNAL_KEY);
  });

  it("POST /runs validates locally: no companies for a selected run, unknown mode", async () => {
    const a = await env.http.post(`${BASE}/runs`).set("Authorization", admin).send({ scope: "selected", companyIds: [] });
    expect([a.status, a.body.code]).toEqual([400, "no_companies"]);
    const b = await env.http.post(`${BASE}/runs`).set("Authorization", admin).send({ mode: "dry" });
    expect([b.status, b.body.code]).toEqual([400, "invalid_mode"]);
    expect(aiCalls(env)).toHaveLength(0);
  });

  it("forwards an upstream 409 run_active with its code and message", async () => {
    env.fetch.on("POST", `${AI}/research/runs`, () =>
      json({ code: "run_active", message: `run ${RUN} is still active; resume or stop it first`, run_id: RUN }, 409));
    const res = await env.http.post(`${BASE}/runs`).set("Authorization", admin).send({});
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ code: "run_active", message: `run ${RUN} is still active; resume or stop it first` });
  });

  it("control actions, run detail and listing pass through", async () => {
    env.fetch.on("POST", `${AI}/research/runs/${RUN}/pause`, { run_id: RUN, status: "pausing" });
    env.fetch.on("GET", `${AI}/research/runs/${RUN}`, { run: { run_id: RUN }, items: [] });
    env.fetch.on("GET", `${AI}/research/runs?limit=100`, { runs: [] });
    expect((await env.http.post(`${BASE}/runs/${RUN}/pause`).set("Authorization", admin)).body.status).toBe("pausing");
    expect((await env.http.get(`${BASE}/runs/${RUN}`).set("Authorization", admin)).body.items).toEqual([]);
    expect((await env.http.get(`${BASE}/runs?limit=500`).set("Authorization", admin)).body).toEqual({ runs: [] });
  });

  it("events: camelCase query → snake_case upstream; blanks dropped", async () => {
    env.fetch.on("GET", `${AI}/research/runs/${RUN}/events`, { events: [], last_seq: 0 });
    await env.http.get(`${BASE}/runs/${RUN}/events?afterSeq=10&level=warn&companyId=c1&spanId=${SPAN}&q=&type=span.`)
      .set("Authorization", admin);
    const url = new URL(aiCalls(env)[0]!.url);
    expect(Object.fromEntries(url.searchParams)).toEqual({ after_seq: "10", level: "warn", company_id: "c1", span_id: SPAN, type: "span." });
  });

  it("PATCH budget maps exaCap/llmCap and rejects negatives", async () => {
    env.fetch.on("PATCH", `${AI}/research/runs/${RUN}/budget`, { run_id: RUN });
    const ok = await env.http.patch(`${BASE}/runs/${RUN}/budget`).set("Authorization", admin).send({ llmCap: 500 });
    expect(ok.status).toBe(200);
    expect(aiCalls(env)[0]!.json).toEqual({ llm_cap: 500 });
    const bad = await env.http.patch(`${BASE}/runs/${RUN}/budget`).set("Authorization", admin).send({ exaCap: -1 });
    expect([bad.status, bad.body.code]).toEqual([400, "invalid_budget"]);
  });

  it("span detail passes through; malformed ids are 400 without an upstream call", async () => {
    env.fetch.on("GET", `${AI}/research/spans/${SPAN}`, { span: { span_id: SPAN }, logs: [] });
    expect((await env.http.get(`${BASE}/spans/${SPAN}`).set("Authorization", admin)).body.span.span_id).toBe(SPAN);
    const badRun = await env.http.get(`${BASE}/runs/not-a-run`).set("Authorization", admin);
    expect([badRun.status, badRun.body.code]).toEqual([400, "invalid_run_id"]);
    const badSpan = await env.http.get(`${BASE}/spans/xyz`).set("Authorization", admin);
    expect([badSpan.status, badSpan.body.code]).toEqual([400, "invalid_span_id"]);
    expect(aiCalls(env)).toHaveLength(1);
  });

  it("AI service unreachable → 502 ai_service_unreachable", async () => {
    const res = await env.http.get(`${BASE}/runs`).set("Authorization", admin);
    expect([res.status, res.body.code]).toEqual([502, "ai_service_unreachable"]);
  });

  it("ADMIN-only", async () => {
    const user = await bearer(env, await createUser(env));
    expect((await env.http.get(`${BASE}/runs`).set("Authorization", user)).status).toBe(403);
    expect((await env.http.get(`${BASE}/runs`)).status).toBe(401);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter @interviewiq/api exec vitest run test/routes/adminResearchController.test.ts`
Expected: FAIL with 404 `not_found` on every route.

- [ ] **Step 3: Implement the router**

`apps/api/src/routes/research.ts`:

```ts
import type { Request, Router } from "express";
import type { Container } from "../container.js";
import { queryInt, queryString, routerErrors, router, stringParam, userId } from "../http/support.js";
import { ApiError } from "../lib/errors.js";
import { UpstreamError, UpstreamHttpError } from "../lib/http.js";
import { isObject } from "../lib/json.js";

/*
 * ADMIN-only BFF proxies for the company research pipeline (gated by the security middleware on
 * /api/v1/admin/**). Payloads pass through as the AI service's snake_case JSON, like the
 * /intelligence proxies. Upstream {code, message} errors are forwarded as-is so the debugger can
 * show exactly what the pipeline said.
 */

const HEX_ID = /^[0-9a-f]{32}$/;
const MODES = ["live", "record", "replay"] as const;
const EVENT_QUERY: ReadonlyArray<readonly [string, string]> = [
  ["afterSeq", "after_seq"],
  ["beforeSeq", "before_seq"],
  ["limit", "limit"],
  ["level", "level"],
  ["companyId", "company_id"],
  ["node", "node"],
  ["type", "type"],
  ["spanId", "span_id"],
  ["q", "q"],
];
const FORWARDED_STATUSES = new Set([400, 404, 409, 503]);

function hexParam(req: Request, name: "runId" | "spanId"): string {
  const value = stringParam(req, name);
  if (!HEX_ID.test(value)) {
    throw new ApiError(400, name === "runId" ? "invalid_run_id" : "invalid_span_id", `${name} must be a 32-character hex id`);
  }
  return value;
}

export function adminResearchRouter(c: Container): Router {
  const r = router();

  r.post("/runs", async (req, res) => {
    const b = isObject(req.body) ? req.body : {};
    const scope = b.scope === "selected" ? "selected" : "all";
    const companyIds = Array.isArray(b.companyIds) ? b.companyIds.filter((x): x is string => typeof x === "string") : [];
    if (scope === "selected" && companyIds.length === 0) throw new ApiError(400, "no_companies", "pick at least one company to research");
    let mode: string | undefined;
    if (b.mode !== undefined) {
      if (typeof b.mode !== "string" || !(MODES as readonly string[]).includes(b.mode)) {
        throw new ApiError(400, "invalid_mode", `mode must be one of [${MODES.join(", ")}]`);
      }
      mode = b.mode;
    }
    const run = await c.aiService.startResearchRun({ scope, company_ids: companyIds, ...(mode ? { mode } : {}), requested_by: userId(req) });
    res.status(201).json(run);
  });

  r.get("/runs", async (req, res) => {
    res.json(await c.aiService.listResearchRuns(Math.min(Math.max(queryInt(req, "limit", 20), 1), 100)));
  });

  r.get("/runs/:runId", async (req, res) => {
    res.json(await c.aiService.getResearchRun(hexParam(req, "runId")));
  });

  for (const action of ["pause", "resume", "stop"] as const) {
    r.post(`/runs/:runId/${action}`, async (req, res) => {
      res.json(await c.aiService.controlResearchRun(hexParam(req, "runId"), action));
    });
  }

  r.patch("/runs/:runId/budget", async (req, res) => {
    const runId = hexParam(req, "runId");
    const b = isObject(req.body) ? req.body : {};
    const body: Record<string, number> = {};
    for (const [from, to] of [["exaCap", "exa_cap"], ["llmCap", "llm_cap"]] as const) {
      const value = b[from];
      if (value === undefined) continue;
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        throw new ApiError(400, "invalid_budget", `${from} must be a non-negative integer`);
      }
      body[to] = value;
    }
    res.json(await c.aiService.patchResearchBudget(runId, body));
  });

  r.get("/runs/:runId/events", async (req, res) => {
    const runId = hexParam(req, "runId");
    const qs = new URLSearchParams();
    for (const [from, to] of EVENT_QUERY) {
      const value = queryString(req, from);
      if (value !== null && value !== "") qs.set(to, value);
    }
    res.json(await c.aiService.listResearchEvents(runId, qs));
  });

  r.get("/runs/:runId/spans", async (req, res) => {
    res.json(await c.aiService.listResearchSpans(hexParam(req, "runId"), queryString(req, "companyId")));
  });

  r.get("/spans/:spanId", async (req, res) => {
    res.json(await c.aiService.getResearchSpan(hexParam(req, "spanId")));
  });

  r.use(
    routerErrors((err) => {
      if (err instanceof UpstreamHttpError && (FORWARDED_STATUSES.has(err.status) || err.status === 422)) {
        const body = parseEnvelope(err.responseBody);
        if (err.status === 422) return { status: 400, code: "invalid_request", message: body?.message ?? err.message };
        return { status: err.status, code: body?.code ?? "research_request_failed", message: body?.message ?? err.message };
      }
      if (err instanceof UpstreamError) {
        c.log.warn(`research proxy: ${err.message}`);
        return { status: 502, code: "ai_service_unreachable", message: "the research service is not reachable" };
      }
      return undefined;
    }),
  );
  return r;
}

/** {code, message} from the AI service, or FastAPI's {detail} for its own validation errors. */
function parseEnvelope(text: string): { code?: string; message?: string } | null {
  try {
    const v: unknown = JSON.parse(text);
    if (!isObject(v)) return null;
    if (typeof v.code === "string") return { code: v.code, message: typeof v.message === "string" ? v.message : undefined };
    if (v.detail !== undefined) return { message: typeof v.detail === "string" ? v.detail : JSON.stringify(v.detail).slice(0, 500) };
    return null;
  } catch {
    return null;
  }
}
```

In `apps/api/src/app.ts`, import `adminResearchRouter` from `./routes/research.js`. Mount it right after the admin users router:

```ts
  v1.use("/admin/research", adminResearchRouter(c));
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `pnpm --filter @interviewiq/api test && pnpm --filter @interviewiq/api typecheck`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run `git status`; leave the changes uncommitted.

---

