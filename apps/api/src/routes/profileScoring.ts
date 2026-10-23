import type { Router } from "express";
import { z } from "zod";
import type { Container } from "../container.js";
import { ENGINEERING_LEVELS, type LiveTraceEvent } from "../domain/profileScoring/types.js";
import { errorDetail } from "../services/profileScoring.js";
import { router, userId } from "../http/support.js";
import { ApiError, BadRequestError } from "../lib/errors.js";

const settingsPatch = z.object({ declaredLevel: z.enum(ENGINEERING_LEVELS).nullable().optional(), leaderboardOptIn: z.boolean().optional() }).strict();
const empty = z.object({}).strict();
const userQuery = z.object({ userId: z.uuid().optional() }).strict();
const liveBody = z.object({ userId: z.uuid(), forceReassess: z.boolean().optional() }).strict();
const boardQuery = z.object({ level: z.enum(ENGINEERING_LEVELS).default("sde1"), limit: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().min(1).max(100)).default(50) }).strict();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequestError(result.error.issues[0]?.message ?? "Invalid scoring request.", "invalid_profile_scoring_request");
  return result.data;
}

export function profileScoringRouter(c: Container): Router {
  const r = router();
  r.get("/users/me/profile-score", async (req, res) => {
    parse(empty, req.query);
    // A user who has never been assessed gets their first assessment now, in the background (once).
    await c.profileScoring.autoAssessIfFirst(userId(req)).catch((err: unknown) => c.log.warn({ err }, "first profile assessment could not start"));
    res.json(await c.profileScoring.get(userId(req)));
  });
  r.post("/users/me/profile-score", async (req, res) => { parse(empty, req.body ?? {}); parse(empty, req.query); res.json(await c.profileScoring.recalculate(userId(req))); });
  r.patch("/users/me/profile-score/settings", async (req, res) => { parse(empty, req.query); res.json(await c.profileScoring.updateSettings(userId(req), parse(settingsPatch, req.body))); });
  r.get("/profile-leaderboard", async (req, res) => { const query = parse(boardQuery, req.query); res.json(await c.profileScoring.leaderboard(query.level, query.limit)); });
  // Existing path-based security middleware enforces ADMIN on both intelligence endpoints.
  r.get("/intelligence/diagnostics", async (req, res) => { const query = parse(userQuery, req.query); res.json(await c.profileScoring.diagnostics(query.userId)); });
  /**
   * Live trace, streamed as NDJSON (one LiveTraceEvent per line) so the admin page shows each step,
   * including AI-service calls, as it happens. The last line is a `result` or an `error` event.
   * Validation and an unknown user are answered with a normal JSON error before streaming starts.
   */
  r.post("/intelligence/profile-scoring/live", async (req, res) => {
    parse(empty, req.query);
    const body = parse(liveBody, req.body ?? {});
    if (!(await c.repos.users.findById(body.userId))) throw new ApiError(404, "user_not_found", "no such user");
    res.status(200).setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    let open = true, errored = false, last: LiveTraceEvent | null = null;
    res.on("close", () => { open = false; });
    const write = (event: LiveTraceEvent) => {
      last = event;
      if (event.kind === "error") errored = true;
      if (open) res.write(`${JSON.stringify(event)}\n`);
    };
    try {
      await c.profileScoring.inspectLive(body.userId, { emit: write, forceReassess: body.forceReassess === true });
    } catch (err) {
      // Failures inside a stage were already emitted with their stack; anything else is emitted here.
      if (!errored) {
        const previous = last as LiveTraceEvent | null;
        write({ seq: (previous?.seq ?? 0) + 1, ts: new Date().toISOString(), elapsedMs: previous?.elapsedMs ?? 0, kind: "error", stage: previous?.stage ?? "route", level: "error",
          message: err instanceof Error ? `${err.name}: ${err.message}` : String(err), data: errorDetail(err) });
      }
      c.log.warn(`profile scoring live trace failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (open) res.end();
    }
  });
  return r;
}
