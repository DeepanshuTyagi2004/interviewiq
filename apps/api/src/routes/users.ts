import type { Router } from "express";
import type { Container } from "../container.js";
import { BadRequestError, InvalidArgumentError } from "../lib/errors.js";
import { isObject } from "../lib/json.js";
import { isUpstreamStatus, UpstreamError, UpstreamHttpError } from "../lib/http.js";
import { readResume, resumeUpload, requiredBody, routerErrors, stringParam, userId, router } from "../http/support.js";
import { parseCandidateProfileRequest } from "../services/candidateProfileService.js";
import { toUserResponse } from "../services/userService.js";

/** GET /users/me — the current user (role + onboarding flag gate the UI). */
export function usersRouter(c: Container): Router {
  const r = router();
  r.get("/me", async (req, res) => {
    const user = await c.users.getById(userId(req));
    if (!user) {
      res.status(404).end();
      return;
    }
    res.json(toUserResponse(user));
  });
  return r;
}

const PARSE_UNAVAILABLE = "Resume parsing is temporarily unavailable. Please try again or enter your details manually.";

/**
 * Onboarding candidate profile under /users/me: resume parse (prefill) + read/upsert. The resume
 * file is only forwarded to the AI service — never stored. Known failures map to stable codes the
 * frontend renders inline and uses to fall back to manual entry.
 */
export function candidateProfileRouter(c: Container): Router {
  const r = router();

  /** Synchronous parse into an unsaved draft (blocks on the LLM). */
  r.post("/resume/parse", resumeUpload, async (req, res) => {
    const { bytes, filename } = readResume(req);
    res.json(await c.candidateProfiles.parseResume(bytes, filename));
  });

  /** Async parse (fire-and-poll): returns the AI service's `{run_id, status}` immediately. */
  r.post("/resume/parse/start", resumeUpload, async (req, res) => {
    const { bytes, filename } = readResume(req);
    res.json(await c.candidateProfiles.startResumeParse(bytes, filename ?? "resume.pdf"));
  });

  /** Poll: `{status: running|completed|failed, profile?, error?}`. */
  r.get("/resume/parse/runs/:runId", async (req, res) => {
    res.json(await c.candidateProfiles.resumeParseRunStatus(stringParam(req, "runId")));
  });

  /** The saved profile, or 204 if none yet. */
  r.get("/candidate-profile", async (req, res) => {
    const profile = await c.candidateProfiles.getProfile(userId(req));
    if (!profile) {
      res.status(204).end();
      return;
    }
    res.json(profile);
  });

  /** Upsert. `complete=true` finishes onboarding. The body is required (it replaces the profile). */
  r.put("/candidate-profile", async (req, res) => {
    const body = requiredBody(req);
    if (!isObject(body)) throw new BadRequestError("a JSON candidate profile object is required");
    res.json(await c.candidateProfiles.saveProfile(userId(req), parseCandidateProfileRequest(body)));
  });

  r.use(
    routerErrors((err) => {
      if (err instanceof InvalidArgumentError) return { status: 400, code: "resume_bad_request", message: err.message };
      // 422 = the PDF had no extractable text (scanned/image-only) → tell the user to type it in.
      if (isUpstreamStatus(err, 422)) {
        return {
          status: 422,
          code: "resume_unreadable",
          message: "We couldn't read that PDF — it may be a scanned image. Please enter your details manually.",
        };
      }
      if (err instanceof UpstreamHttpError) c.log.warn(`resume parse upstream error ${err.status}: ${err.message}`);
      else if (err instanceof UpstreamError) c.log.warn(`resume parse upstream failure: ${err.message}`);
      if (err instanceof UpstreamError) return { status: 502, code: "resume_parse_failed", message: PARSE_UNAVAILABLE };
      return undefined;
    }),
  );
  return r;
}
