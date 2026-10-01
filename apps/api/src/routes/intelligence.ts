import type { Router } from "express";
import { randomUUID } from "node:crypto";
import type { Container } from "../container.js";
import { DEFAULT_ROUND_TYPE, optionalRoundType } from "../domain/enums.js";
import { InvalidArgumentError } from "../lib/errors.js";
import { isUpstreamStatus, UpstreamError } from "../lib/http.js";
import { firstNonBlank, isObject } from "../lib/json.js";
import { queryInt, queryString, readResume, requiredBody, resumeUpload, routerErrors, stringParam, router } from "../http/support.js";
import { resolvePlanProfile } from "../services/interviewPrep.js";
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

  r.get("/questions", async (req, res) => {
    const limit = Math.min(queryInt(req, "limit", 100), 500);
    const node = await c.aiService.listQuestions(queryString(req, "roundType"), queryString(req, "company"), queryString(req, "difficulty"), limit);
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
 * Interview-prep (Pipeline 1) test bench: the admin picks a JD (+ optional candidate); we assemble
 * the same request the scheduler sends — with a synthetic session id — and start an instrumented run.
 */
export function interviewPrepBenchRouter(c: Container): Router {
  const r = router();

  /** Onboarded candidates (those with a saved profile), sorted by name. `id` is the userId. */
  r.get("/candidates", async (_req, res) => {
    const profiles = await c.repos.candidateProfiles.findAll();
    const users = new Map((await c.repos.users.findAllById(profiles.map((p) => p.userId))).map((u) => [u.id, u]));
    const options = profiles.map((p) => {
      const u = users.get(p.userId);
      return {
        id: p.userId,
        name: firstNonBlank(u?.name, p.fullName, "Unnamed candidate")!,
        email: u ? u.email : p.email,
      };
    });
    options.sort((a, b) => cmp(a.name.toLowerCase(), b.name.toLowerCase()));
    res.json(options);
  });

  /** Start an instrumented run → `{run_id, status}`. Round defaults to the first round. */
  r.post("/run", async (req, res) => {
    const b = isObject(req.body) ? req.body : {};
    const jobDescriptionId = uuidField(b.jobDescriptionId, "jobDescriptionId");
    if (!jobDescriptionId) throw new InvalidArgumentError("jobDescriptionId is required");
    const candidateId = uuidField(b.candidateId, "candidateId");
    const roundType = optionalRoundType(b.roundType) ?? DEFAULT_ROUND_TYPE;

    const jd = await c.repos.jds.findById(jobDescriptionId);
    if (!jd) throw new InvalidArgumentError("unknown job description");

    res.json(
      await c.aiService.startInterviewPrepRun({
        session: {
          sessionId: randomUUID(),
          candidateId: candidateId ?? randomUUID(),
          company: jd.company,
          role: jd.role,
          level: jd.level,
          specialization: jd.specialization,
          roundType,
        },
        jobDescription: { id: jd.id, title: jd.title, description: jd.description, techStack: jd.techStack },
        candidateProfile: await resolvePlanProfile(c.candidateProfiles, c.codingSignals, candidateId),
      }),
    );
  });

  r.get("/runs", async (_req, res) => {
    res.json(await c.aiService.listInterviewPrepRuns());
  });

  r.get("/runs/:runId", async (req, res) => {
    res.json(await c.aiService.getInterviewPrepRun(stringParam(req, "runId"), queryInt(req, "after", 0)));
  });

  r.use(runProxyErrors(c, "prep_bad_request", "no such interview-prep run", "AI service interview-prep run call failed"));
  return r;
}

/** Résumé-parse observability bench (admin copy of the onboarding parse, fully instrumented). */
export function resumeBenchRouter(c: Container): Router {
  const r = router();

  r.post("/parse/run", resumeUpload, async (req, res) => {
    const { bytes, filename } = readResume(req);
    res.json(await c.aiService.startResumeParseRun(bytes, filename ?? "résumé.pdf"));
  });

  r.get("/parse/runs", async (_req, res) => {
    res.json(await c.aiService.listResumeParseRuns());
  });

  r.get("/parse/runs/:runId", async (req, res) => {
    res.json(await c.aiService.getResumeParseRun(stringParam(req, "runId"), queryInt(req, "after", 0)));
  });

  r.use(runProxyErrors(c, "resume_bad_request", "no such résumé-parse run", "AI service résumé-run call failed"));
  return r;
}

/** Agent Diagnostics: interactive harness around the live-interview brain. */
export function interviewAgentBenchRouter(c: Container): Router {
  const r = router();

  r.post("/run", async (req, res) => {
    res.json(await c.aiService.startAgentRun(requiredBody(req)));
  });

  /** Submit a candidate turn (or silence/end). */
  r.post("/runs/:runId/turn", async (req, res) => {
    res.json(await c.aiService.submitAgentTurn(stringParam(req, "runId"), requiredBody(req)));
  });

  r.get("/runs/:runId", async (req, res) => {
    res.json(await c.aiService.getAgentRun(stringParam(req, "runId"), queryInt(req, "after", 0)));
  });

  r.get("/runs", async (_req, res) => {
    res.json(await c.aiService.listAgentRuns());
  });

  /** Force-end a diagnostic session. */
  r.post("/runs/:runId/end", async (req, res) => {
    res.json(await c.aiService.endAgentRun(stringParam(req, "runId")));
  });

  r.use(
    routerErrors((err) => {
      if (isUpstreamStatus(err, 404)) return { status: 404, code: "run_not_found", message: "no such diagnostic session" };
      if (isUpstreamStatus(err, 429)) return { status: 429, code: "sessions_at_capacity", message: "too many active diagnostic sessions" };
      if (err instanceof UpstreamError) {
        c.log.warn(`AI service interview-agent call failed: ${err.message}`);
        return { status: 502, code: "ai_service_unreachable", message: "ai-service unavailable" };
      }
      return undefined;
    }),
  );
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
