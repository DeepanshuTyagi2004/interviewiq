import type { Router } from "express";
import type { Container } from "../container.js";
import { optionalRoundType } from "../domain/enums.js";
import { InvalidArgumentError } from "../lib/errors.js";
import { isUpstreamStatus, UpstreamError } from "../lib/http.js";
import { firstNonBlank, isObject } from "../lib/json.js";
import { queryInt, queryString, readResume, resumeUpload, routerErrors, stringParam, router } from "../http/support.js";
import { aiServiceUnreachable } from "./catalogue.js";

/*
 * ADMIN-only BFF proxies for the interview-intelligence consoles (gated by the security middleware
 * on /api/v1/intelligence/**). The browser talks to these with its JWT; they forward to the AI
 * service with the internal API key, which never reaches the browser.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Brief-generation pipeline, question bank, briefs. */
export function intelligenceRouter(c: Container): Router {
  const r = router();

  r.post("/scrape/run", async (_req, res) => {
    res.json(await c.aiService.triggerScrape());
  });

  /** Stop the active ingestion run (halts after the current JD). */
  r.post("/scrape/stop", async (_req, res) => {
    res.json(await c.aiService.stopScrape());
  });

  /** Live run state + incremental logs. Poll with ?after=<last_seq>. */
  r.get("/scrape/status", async (req, res) => {
    res.json(await c.aiService.getScrapeStatus(queryInt(req, "after", 0)));
  });

  /** Question-set collection run (status via the shared /scrape/status feed). */
  r.post("/questions/collect", async (_req, res) => {
    res.json(await c.aiService.collectQuestions());
  });

  /** Content generation over the question index (docs/question-bank.md); status via /scrape/status. */
  r.post("/questions/generate", async (req, res) => {
    const limit = queryInt(req, "limit", 0);
    res.json(await c.aiService.generateQuestionContent({ roundType: queryString(req, "roundType"), limit: limit > 0 ? limit : null, force: queryString(req, "force") === "true" }));
  });

  r.get("/questions/stats", async (_req, res) => {
    res.json((await c.aiService.questionStats()) ?? { rounds: {}, total: 0 });
  });

  r.get("/questions", async (req, res) => {
    const limit = Math.min(queryInt(req, "limit", 100), 500);
    const node = await c.aiService.listQuestions(queryString(req, "roundType"), queryString(req, "company"), queryString(req, "difficulty"), limit,
      { contentStatus: queryString(req, "contentStatus"), topic: queryString(req, "topic"), includeContent: queryString(req, "includeContent") === "true" });
    res.json(node ?? { questions: [], count: 0 });
  });

  /** Clear all generated briefs (destructive). The catalogue is untouched. */
  r.post("/briefs/clear", async (_req, res) => {
    res.json(await c.aiService.clearBriefs());
  });

  r.get("/briefs", async (_req, res) => {
    res.json((await c.aiService.listBriefSummaries()) ?? { briefs: [] });
  });

  r.get("/briefs/:company/:role/:level/:specialization", async (req, res) => {
    const brief = await c.aiService.fetchBrief(
      stringParam(req, "company"),
      stringParam(req, "role"),
      stringParam(req, "level"),
      stringParam(req, "specialization"),
    );
    if (brief === null) {
      res.status(404).json({ code: "brief_not_found", message: "no brief for that JD yet" });
      return;
    }
    res.json(brief);
  });

  r.use(aiServiceUnreachable(c, "AI service call failed"));
  return r;
}

/**
 * Interview blueprint diagnostics (spec §10), mounted at /api/v1/intelligence/blueprints. Snake-case
 * passthrough of the AI service's admin routes, plus the bench: the API assembles the same request a
 * booking would (never attached to a session) from a candidate + JD (or practice loop) + round.
 */
export function blueprintAdminRouter(c: Container): Router {
  const r = router();

  /** Onboarded candidates (those with a saved profile), sorted by name. `id` is the userId. */
  r.get("/candidates", async (_req, res) => {
    const profiles = await c.repos.candidateProfiles.findAll();
    const users = new Map((await c.repos.users.findAllById(profiles.map((p) => p.userId))).map((u) => [u.id, u]));
    const options = profiles.map((p) => {
      const u = users.get(p.userId);
      return { id: p.userId, name: firstNonBlank(u?.name, p.fullName, "Unnamed candidate")!, email: u ? u.email : p.email };
    });
    options.sort((a, b) => cmp(a.name.toLowerCase(), b.name.toLowerCase()));
    res.json(options);
  });

  r.get("/runs", async (req, res) => {
    const q = new URLSearchParams();
    for (const key of ["status", "company", "round_type", "trigger", "candidate_id", "session_id", "from", "to", "limit", "cursor"]) {
      const v = queryString(req, key);
      if (v) q.set(key, v);
    }
    res.json(await c.aiService.listBlueprintRuns(q));
  });

  r.get("/runs/:runId", async (req, res) => {
    res.json(await c.aiService.getBlueprintRunDetail(stringParam(req, "runId")));
  });

  /** Bench: `{candidateId, jobDescriptionId | loopId+nodeId, roundType?, options?}` → `{run_id, status}`. */
  r.post("/bench", async (req, res) => {
    const b = isObject(req.body) ? req.body : {};
    const candidateId = uuidField(b.candidateId, "candidateId");
    if (!candidateId) throw new InvalidArgumentError("candidateId is required");
    const options = isObject(b.options) ? b.options : {};
    const request = await c.blueprintPrep.benchRequest({
      candidateId,
      jobDescriptionId: uuidField(b.jobDescriptionId, "jobDescriptionId"),
      loopId: uuidField(b.loopId, "loopId"),
      nodeId: typeof b.nodeId === "string" && b.nodeId.length <= 64 ? b.nodeId : null,
      roundType: optionalRoundType(b.roundType),
      options: {
        bypass_blueprint_cache: options.bypassBlueprintCache === true,
        bypass_answer_key_cache: options.bypassAnswerKeyCache === true,
        ignore_exclusions: options.ignoreExclusions === true,
      },
    });
    res.json(await c.aiService.startBlueprintBench(request));
  });

  r.post("/runs/:runId/rerun", async (req, res) => {
    const b = isObject(req.body) ? req.body : {};
    res.json(await c.aiService.rerunBlueprint(stringParam(req, "runId"), {
      bypass_blueprint_cache: true,
      bypass_answer_key_cache: b.bypassAnswerKeyCache === true,
      ignore_exclusions: b.ignoreExclusions === true,
    }));
  });

  r.get("/sessions/:sessionId/versions", async (req, res) => {
    res.json(await c.aiService.blueprintVersions(stringParam(req, "sessionId")));
  });

  r.get("/sessions/:sessionId/diff", async (req, res) => {
    const from = queryInt(req, "from", 0), to = queryInt(req, "to", 0);
    if (from < 1 || to < 1) throw new InvalidArgumentError("from and to are required versions");
    res.json(await c.aiService.blueprintDiff(stringParam(req, "sessionId"), from, to));
  });

  r.get("/answer-keys/:roundType/*slug", async (req, res) => {
    const slug = req.params.slug;
    res.json(await c.aiService.blueprintAnswerKeys(stringParam(req, "roundType"), Array.isArray(slug) ? slug.join("/") : String(slug)));
  });

  r.use(runProxyErrors(c, "blueprint_bad_request", "no such blueprint run", "AI service blueprint call failed"));
  return r;
}

/**
 * Round-evaluation diagnostics (post-interview report spec §11), mounted at /api/v1/intelligence/evaluations. Snake-case
 * passthrough of the AI service's admin routes, plus the session re-run (a fresh `admin` run attached to the session).
 */
export function evaluationAdminRouter(c: Container): Router {
  const r = router();

  r.get("/runs", async (req, res) => {
    const q = new URLSearchParams();
    for (const key of ["status", "company", "round_type", "trigger", "outcome", "candidate_id", "session_id", "from", "to", "limit", "cursor"]) {
      const v = queryString(req, key);
      if (v) q.set(key, v);
    }
    res.json(await c.aiService.listEvaluationRuns(q));
  });

  r.get("/runs/:runId", async (req, res) => {
    res.json(await c.aiService.getEvaluationRunAdmin(stringParam(req, "runId")));
  });

  /** Re-grade a completed session from scratch: `{runId}`. */
  r.post("/sessions/:sessionId/rerun", async (req, res) => {
    const sessionId = stringParam(req, "sessionId");
    if (!UUID_RE.test(sessionId)) throw new InvalidArgumentError("sessionId must be a UUID");
    res.json(await c.roundEvaluation.rerun(sessionId.toLowerCase()));
  });

  r.use(runProxyErrors(c, "evaluation_bad_request", "no such evaluation run", "AI service evaluation call failed"));
  return r;
}

/** Resume-parse observability bench (admin copy of the onboarding parse, fully instrumented). */
export function resumeBenchRouter(c: Container): Router {
  const r = router();

  r.post("/parse/run", resumeUpload, async (req, res) => {
    const { bytes, filename } = readResume(req);
    res.json(await c.aiService.startResumeParseRun(bytes, filename ?? "resume.pdf"));
  });

  r.get("/parse/runs", async (_req, res) => {
    res.json(await c.aiService.listResumeParseRuns());
  });

  r.get("/parse/runs/:runId", async (req, res) => {
    res.json(await c.aiService.getResumeParseRun(stringParam(req, "runId"), queryInt(req, "after", 0)));
  });

  r.use(runProxyErrors(c, "resume_bad_request", "no such resume-parse run", "AI service resume-run call failed"));
  return r;
}

function runProxyErrors(c: Container, badRequestCode: string, notFoundMessage: string, logPrefix: string) {
  return routerErrors((err) => {
    if (err instanceof InvalidArgumentError) return { status: 400, code: badRequestCode, message: err.message };
    if (isUpstreamStatus(err, 404)) return { status: 404, code: "run_not_found", message: notFoundMessage };
    if (err instanceof UpstreamError) {
      c.log.warn(`${logPrefix}: ${err.message}`);
      return { status: 502, code: "ai_service_unreachable", message: "the intelligence service is not reachable" };
    }
    return undefined;
  });
}

function uuidField(v: unknown, name: string): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new InvalidArgumentError(`${name} must be a UUID`);
  return v.toLowerCase();
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
