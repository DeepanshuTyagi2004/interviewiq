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
