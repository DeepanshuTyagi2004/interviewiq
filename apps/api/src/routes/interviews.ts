import type { Router } from "express";
import type { Container } from "../container.js";
import { InvalidArgumentError } from "../lib/errors.js";
import { isObject } from "../lib/json.js";
import { routerErrors, userId, uuidParam, router } from "../http/support.js";
import { parseCreateSessionRequest } from "../services/interviewSessions.js";

/**
 * Candidate-facing interview booking + blueprint prep status, plus go-live/resume (live
 * runtime). Every endpoint is scoped to the authenticated candidate. Mirrors the
 * `interview-sessions` paths in packages/contracts/openapi.yaml.
 */
export function interviewsRouter(c: Container): Router {
  const r = router();

  /** Book a session for a JD + slot. */
  r.post("/sessions", async (req, res) => {
    res.status(201).json(await c.sessions.createSession(userId(req), parseCreateSessionRequest(req.body)));
  });

  /** The candidate's sessions (newest slot first). */
  r.get("/sessions", async (req, res) => {
    res.json(await c.sessions.listSessions(userId(req)));
  });

  /** Move a not-yet-started interview to another slot. */
  r.post("/sessions/:sessionId/reschedule", async (req, res) => {
    const b = parseCreateSessionRequest({ ...(isObject(req.body) ? req.body : {}), loopId: undefined, nodeId: undefined });
    if (!b.scheduledAt || !b.timezone) throw new InvalidArgumentError("scheduledAt and timezone are required");
    res.json(await c.sessions.reschedule(userId(req), uuidParam(req, "sessionId"), b.scheduledAt, b.timezone));
  });

  /** Cancel a not-yet-started interview. */
  r.post("/sessions/:sessionId/cancel", async (req, res) => {
    res.json(await c.sessions.cancel(userId(req), uuidParam(req, "sessionId")));
  });

  r.get("/sessions/:sessionId", async (req, res) => {
    res.json(await c.sessions.getSession(userId(req), uuidParam(req, "sessionId")));
  });

  /** Retry blueprint prep after PREP_FAILED (3 per rolling hour; 429 `prep_retry_limited`). */
  r.post("/sessions/:sessionId/prep/retry", async (req, res) => {
    res.status(202).json(await c.sessions.retryPrep(userId(req), uuidParam(req, "sessionId")));
  });

  /** Go live: PREP_READY → LIVE_IN_PROGRESS + a LiveKit token. Resuming returns a fresh token. */
  r.post("/sessions/:sessionId/live", async (req, res) => {
    res.json(await c.liveSessions.startLive(userId(req), uuidParam(req, "sessionId")));
  });

  /** Gate/resume: current live state, with a fresh token when already live. */
  r.get("/sessions/:sessionId/live", async (req, res) => {
    res.json(await c.liveSessions.getLive(userId(req), uuidParam(req, "sessionId")));
  });

  /** Get the interviewer into the room while the candidate reads the instructions: best effort, never an error for a round that is not eligible. */
  r.post("/sessions/:sessionId/live/warm", async (req, res) => {
    res.json(await c.liveSessions.warm(userId(req), uuidParam(req, "sessionId")));
  });

  /** The candidate ends the live round: the fallback when the interviewer doesn't answer End (idempotent). */
  r.post("/sessions/:sessionId/live/end", async (req, res) => {
    res.json(await c.liveSessions.endFromCandidate(userId(req), uuidParam(req, "sessionId")));
  });

  r.use(
    routerErrors((err) =>
      err instanceof InvalidArgumentError ? { status: 400, code: "session_bad_request", message: err.message } : undefined,
    ),
  );
  return r;
}
