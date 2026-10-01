import type { Router } from "express";
import type { Container } from "../container.js";
import { InvalidArgumentError } from "../lib/errors.js";
import { routerErrors, userId, uuidParam, router } from "../http/support.js";
import { parseCreateSessionRequest } from "../services/interviewSessions.js";

/**
 * Candidate-facing interview booking + prep status (Pipeline 1), plus go-live/resume (live
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

  r.get("/sessions/:sessionId", async (req, res) => {
    res.json(await c.sessions.getSession(userId(req), uuidParam(req, "sessionId")));
  });

  /** Re-queue prep (retry after PREP_FAILED, or refresh). */
  r.post("/sessions/:sessionId/regenerate", async (req, res) => {
    res.status(202).json(await c.sessions.regenerate(userId(req), uuidParam(req, "sessionId")));
  });

  /** Go live: PREP_READY → LIVE_IN_PROGRESS + a LiveKit token. Resuming returns a fresh token. */
  r.post("/sessions/:sessionId/live", async (req, res) => {
    res.json(await c.liveSessions.startLive(userId(req), uuidParam(req, "sessionId")));
  });

  /** Gate/resume: current live state, with a fresh token when already live. */
  r.get("/sessions/:sessionId/live", async (req, res) => {
    res.json(await c.liveSessions.getLive(userId(req), uuidParam(req, "sessionId")));
  });

  r.use(
    routerErrors((err) =>
      err instanceof InvalidArgumentError ? { status: 400, code: "session_bad_request", message: err.message } : undefined,
    ),
  );
  return r;
}
