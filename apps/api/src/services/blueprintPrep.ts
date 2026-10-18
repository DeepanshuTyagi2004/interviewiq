import { createHash } from "node:crypto";
import type { InterviewSessionRow, LoopRow } from "../db/pg/schema.js";
import type { CandidateProfileResponse } from "../domain/candidateProfile.js";
import type { RoundType } from "../domain/enums.js";
import { sessionRoundMinutes } from "../domain/liveRound.js";
import { practiceSnapshot } from "../domain/practice.js";
import { roundNodes } from "../domain/process.js";
import type { AiServiceClient } from "../integrations/aiService/client.js";
import type { BlueprintCandidateProfile, BlueprintRound, BlueprintRunRequest } from "../integrations/aiService/types.js";
import type { BackgroundTasks } from "../lib/background.js";
import { ApiError, errorMessage, InvalidArgumentError } from "../lib/errors.js";
import { UpstreamHttpError } from "../lib/http.js";
import { isObject, items, path, textOrNull } from "../lib/json.js";
import type { Logger } from "../lib/logger.js";
import type { BlueprintSeenRepository, ProfileFragmentRepository } from "../repositories/mongo.js";
import type { InterviewSessionRepository, JobDescriptionRepository, LoopRepository, UserRepository } from "../repositories/pg.js";
import type { CandidateProfileService } from "./candidateProfileService.js";
import type { CompanyEnrichmentService } from "./companyEnrichment.js";
import { type JdBriefDeps, resolveJdBrief } from "./jdCatalogue.js";

/**
 * Interview blueprint prep, API side (docs/superpowers/specs/2026-10-07-interview-blueprint-design.md §5).
 *
 * Assembles a session's inputs (JD, the booked round, the company brief, a minimal candidate profile,
 * the problems the candidate must not get again), fingerprints them, starts a blueprint run in the AI
 * service, and applies finished runs to the session: PREP_READY with the version and briefing, or
 * PREP_FAILED with a stable code. A ready session is re-prepared when its fingerprint changes; the old
 * blueprint stays live until the new one succeeds. The reconcile job drives everything after booking.
 */

export type PrepTrigger = BlueprintRunRequest["trigger"];
export type PrepStep = { id: string; state: "done" | "active" | "pending" | "failed"; elapsedMs: number | null };

export interface BlueprintPrepOptions {
  runTimeoutMinutes: number;
  retryLimitPerHour: number;
  refreshCutoffMinutes: number;
}

export interface BlueprintPrepDeps {
  sessions: InterviewSessionRepository;
  jds: JobDescriptionRepository;
  loops: LoopRepository;
  users: UserRepository;
  candidateProfiles: CandidateProfileService;
  fragments: ProfileFragmentRepository;
  seen: BlueprintSeenRepository;
  enrichment: CompanyEnrichmentService;
  aiService: AiServiceClient;
  background: BackgroundTasks;
  log: Logger;
  options: BlueprintPrepOptions;
}

export class PrepRetryError extends ApiError {}

/** Failures that are the infrastructure's, not the inputs': worth another go before the candidate sees them. */
const TRANSIENT_CODES = new Set(["llm_unavailable", "timeout", "internal_error", "interrupted"]);
/** Automatic re-runs after a transient failure, per rolling hour (they share the candidate's retry counter). */
const AUTO_RETRIES = 2;

/** Stable JSON: object keys sorted at every level, so the fingerprint ignores key order. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * Part of the fingerprint, so ready sessions are re-prepared when a prep change must reach them (a change to the inputs alone
 * would leave blueprints prepared before it running as they were). Bump it then. Must equal PREP_VERSION in the AI service's
 * app/blueprint/pipeline.py.
 */
export const PREP_VERSION = "shapes-1";

/** The fingerprint parts (spec §5.1); the AI service computes the same split for its cache. */
export function fingerprint(req: Omit<BlueprintRunRequest, "input_hash" | "input_parts">): { hash: string; parts: Record<string, string> } {
  const s = req.session;
  const parts: Record<string, unknown> = {
    jd: req.job_description, round: req.round, brief: req.company_brief, profile: req.candidate_profile,
    exclusions: [...req.exclusions].sort(), level: [s.level, s.round_type, s.company, s.role],
    prep: PREP_VERSION,
  };
  const hashed = Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, sha(stable(v)).slice(0, 16)]));
  return { hash: sha(stable(hashed)), parts: hashed };
}

const diff = (d: unknown): BlueprintRound["difficulty"] => (d === "easy" || d === "medium" || d === "hard" ? d : null);
const strings = (v: unknown): string[] => items(v).filter((x): x is string => typeof x === "string" && x.trim() !== "");

/** The booked round: the practice snapshot, else the loop node (+ the brief round it came from), else the brief. */
export function resolveRound(session: InterviewSessionRow, brief: unknown, loop: LoopRow | null): BlueprintRound | null {
  const briefRounds = items(path(isObject(path(brief, "final_experience")) ? path(brief, "final_experience") : path(brief, "consolidated_process"), "rounds"));
  const fromBrief = (r: unknown, source: BlueprintRound["source"]): BlueprintRound => ({
    type: session.roundType,
    name: textOrNull(path(r, "name")),
    duration_mins: sessionRoundMinutes(session), // the session's drawn length; the researched length describes the real round, not the mock
    format: textOrNull(path(r, "format")),
    topics: strings(path(r, "topics")),
    problems: strings(path(r, "problems")),
    difficulty: diff(path(r, "difficulty")),
    source,
  });
  if (session.practicePrep) {
    const r = session.practicePrep.companyBrief.final_experience.rounds[0];
    return r ? fromBrief(r, "practice") : null;
  }
  const node = loop && session.nodeId ? roundNodes(loop.graph).find((n) => n.id === session.nodeId) : undefined;
  const sameId = node ? briefRounds.find((r) => path(r, "id") === node.id) : undefined;
  if (node) {
    return {
      type: node.type, name: node.name, duration_mins: sessionRoundMinutes(session), format: node.instructions ?? textOrNull(path(sameId, "format")),
      topics: node.topics, problems: sameId ? strings(path(sameId, "problems")) : [], difficulty: node.difficulty, source: "brief",
    };
  }
  const match = briefRounds.find((r) => path(r, "type") === session.roundType && path(r, "kind") !== "info");
  return match ? fromBrief(match, "brief") : null;
}

function companyBrief(brief: unknown): BlueprintRunRequest["company_brief"] {
  if (!isObject(brief)) return null;
  const fe = isObject(path(brief, "final_experience")) ? path(brief, "final_experience") : path(brief, "consolidated_process");
  return {
    dominant_topics: strings(path(fe, "dominant_topics")),
    difficulty_calibration: textOrNull(path(fe, "difficulty_calibration")),
    interviewer_style_notes: textOrNull(path(fe, "interviewer_style_notes")),
    company_specific_patterns: textOrNull(path(fe, "company_specific_patterns")),
    red_flags: strings(path(fe, "red_flags")),
  };
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Solve counts and top topics from the coding fragments: the most a coding round needs to calibrate. */
function codingSummary(fragments: Map<string, Record<string, unknown>>): BlueprintCandidateProfile["coding"] {
  const lc = fragments.get("LEETCODE");
  const solved = isObject(lc?.solved) ? lc.solved : {};
  const easy = num(solved.easy), medium = num(solved.medium), hard = num(solved.hard);
  const lcTotal = num(solved.total) ?? (easy !== null || medium !== null || hard !== null ? (easy ?? 0) + (medium ?? 0) + (hard ?? 0) : null);
  const others = ["CODEFORCES", "TUF", "CODECHEF", "ATCODER"].map((s) => {
    const f = fragments.get(s);
    return f ? num(f.totalSolved) ?? num(f.fullySolved) ?? num(f.acceptedCount) : null;
  });
  const totals = [lcTotal, ...others].filter((n): n is number => n !== null);
  const byTopic = items(lc?.byTopic).filter(isObject)
    .map((t) => ({ name: textOrNull(t.name) ?? textOrNull(t.topic) ?? textOrNull(t.tagName), count: num(t.count) ?? num(t.problemsSolved) ?? 0 }))
    .filter((t): t is { name: string; count: number } => t.name !== null)
    .sort((a, b) => b.count - a.count).slice(0, 6).map((t) => t.name);
  if (totals.length === 0 && byTopic.length === 0) return null;
  return { total_solved: totals.length ? Math.max(...totals) : null, easy, medium, hard, top_topics: byTopic };
}

function yearsOf(start: string | null, end: string | null): number {
  const year = (s: string | null) => {
    const m = s?.match(/(19|20)\d{2}/);
    return m ? Number(m[0]) : null;
  };
  const a = year(start), b = end && /present|current/i.test(end) ? new Date().getFullYear() : year(end);
  return a !== null && b !== null && b >= a ? b - a : 0;
}

/** A minimal projection of the profile: no contact details, no links, no achievements prose. */
export function profileProjection(p: CandidateProfileResponse | null, fragments: Map<string, Record<string, unknown>>): BlueprintCandidateProfile {
  const experience = (p?.experience ?? []).map((e) => ({
    title: e.title, company: e.company, summary: (e.bullets ?? []).slice(0, 3).join(" ") || null,
    start: e.startDate, end: e.endDate, internship: /intern/i.test(e.title ?? ""),
  }));
  const fullTime = experience.filter((e) => !e.internship).reduce((sum, e) => sum + yearsOf(e.start, e.end), 0);
  return {
    headline: p?.headline ?? null,
    level: p?.level ?? null,
    years_experience: experience.length ? fullTime : null,
    skills: (p?.skills ?? []).slice(0, 40),
    projects: (p?.projects ?? []).filter((x) => x.name).slice(0, 8).map((x) => ({
      name: x.name!, stack: x.tech ?? [], summary: x.description ?? ((x.bullets ?? []).slice(0, 2).join(" ") || null),
    })),
    experience: experience.slice(0, 8),
    education: (p?.education ?? []).slice(0, 4).map((e) => ({ institution: e.institution, degree: e.degree, field: e.field, year: e.endYear })),
    coding: codingSummary(fragments),
  };
}

export class BlueprintPrepService {
  constructor(private readonly d: BlueprintPrepDeps) {}

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

  // ---------------------------------------------------------------- inputs

  /** The run request for a session (or a bench run when `session.id` is null-like via `bench`). */
  async assemble(session: InterviewSessionRow, trigger: PrepTrigger, options?: Partial<BlueprintRunRequest["options"]>,
                 bench = false): Promise<BlueprintRunRequest> {
    const jd = session.jobDescriptionId ? await this.d.jds.findById(session.jobDescriptionId) : null;
    const loop = session.loopId ? await this.d.loops.findOwned(session.loopId, session.candidateId) : null;
    const deps: JdBriefDeps = { enrichment: this.d.enrichment, aiService: this.d.aiService };
    const brief: unknown = session.practicePrep?.companyBrief ?? (jd ? (await resolveJdBrief(deps, jd)).brief : null);
    const [profile, fragmentRows, seen, user] = await Promise.all([
      this.d.candidateProfiles.getProfile(session.candidateId),
      this.d.fragments.findByUserId(session.candidateId),
      this.d.seen.slugsFor(session.candidateId),
      this.d.users.findById(session.candidateId),
    ]);
    const fragments = new Map(fragmentRows.filter((f) => isObject(f.data)).map((f) => [f.source as string, f.data]));
    const jdView = session.practicePrep?.jobDescription;
    const body: Omit<BlueprintRunRequest, "input_hash" | "input_parts"> = {
      session: {
        session_id: bench ? null : session.id, candidate_id: session.candidateId, candidate_label: user?.email ?? null,
        company: session.company, role: session.role, level: session.level, specialization: session.specialization,
        round_type: session.roundType as RoundType, scheduled_at: session.scheduledAt?.toISOString() ?? null,
        loop_id: session.loopId, node_id: session.nodeId,
      },
      job_description: jdView
        ? { id: jdView.id, title: jdView.title, description: jdView.description, tech_stack: jdView.techStack }
        : { id: jd?.id ?? null, title: jd?.title ?? session.role, description: jd?.description ?? null, tech_stack: jd?.techStack ?? null },
      round: resolveRound(session, brief, loop),
      company_brief: companyBrief(brief),
      candidate_profile: profileProjection(profile, fragments),
      exclusions: seen,
      trigger,
      options: { bypass_blueprint_cache: false, bypass_answer_key_cache: false, ignore_exclusions: false, ...options },
    };
    const fp = fingerprint(body);
    return { ...body, input_hash: fp.hash, input_parts: fp.parts };
  }

  /**
   * The admin bench (spec §10): the request a booking would send for this candidate + JD (or practice
   * loop node) + round, never attached to a session.
   */
  async benchRequest(input: {
    candidateId: string; jobDescriptionId: string | null; loopId: string | null; nodeId: string | null;
    roundType: RoundType | null; options: BlueprintRunRequest["options"];
    /** The round length to prepare for (30, 35, 40 or 45); a bench run has no booking to draw it, so it defaults to 45. */
    roundMinutes?: number;
  }): Promise<BlueprintRunRequest> {
    const loop = input.loopId ? await this.d.loops.findOwned(input.loopId, input.candidateId) : null;
    if (input.loopId && !loop) throw new InvalidArgumentError("that loop does not belong to this candidate");
    const node = loop && input.nodeId ? roundNodes(loop.graph).find((n) => n.id === input.nodeId) : undefined;
    if (loop && !node) throw new InvalidArgumentError("that round is not part of this loop");
    const jdId = loop ? loop.jdId : input.jobDescriptionId;
    const jd = jdId ? await this.d.jds.findById(jdId) : null;
    if (!loop && !jd) throw new InvalidArgumentError("jobDescriptionId (or loopId + nodeId) is required");
    // No round given: the one a booking starts on (the brief's first interview round), as createSession does.
    const manual = !node && !input.roundType && jd ? await this.d.enrichment.briefForJd(jd.id) : null;
    const firstRound = manual?.final_experience.rounds.find((r) => r.kind !== "info")?.type ?? null;
    const identity = {
      company: jd?.company ?? "custom-practice", role: jd?.role ?? loop!.name,
      level: loop && (loop.kind === "standalone" || !jd) ? loop.level : jd!.level, specialization: jd?.specialization ?? null,
    };
    const practice = loop && node && (loop.kind === "standalone" || jd?.source === "template" || !jd);
    const row = {
      id: "bench", candidateId: input.candidateId, jobDescriptionId: jd?.id ?? null, ...identity,
      roundType: node?.type ?? input.roundType ?? firstRound ?? "dsa", scheduledAt: new Date(), timezone: "UTC", status: "SCHEDULED",
      loopId: loop?.id ?? null, nodeId: node?.id ?? null, roundMinutes: input.roundMinutes ?? null,
      practicePrep: practice ? practiceSnapshot(loop!, node!, identity) : null,
      prepRunId: null, prepRunStartedAt: null, prepInputHash: null, blueprintVersion: null, prepErrorCode: null,
      prepRefreshing: false, prepRetryCount: 0, prepRetryWindowStart: null, preparedAt: null, prepBriefing: null,
    } as unknown as InterviewSessionRow;
    return this.assemble(row, "bench", input.options, true);
  }

  // ---------------------------------------------------------------- lifecycle

  /** Booking: queue prep and start it now (the reconcile job retries if this attempt fails). */
  async onBooked(session: InterviewSessionRow): Promise<InterviewSessionRow> {
    const queued = await this.d.sessions.transitionStatus(session.id, "SCHEDULED", "PREP_QUEUED", { prepErrorCode: null }) ?? session;
    this.d.background.run(`blueprint-start-${session.id}`, () => this.start(queued, "booking"));
    return queued;
  }

  /** Cancelling a session stops its run; its blueprints stay until account deletion. */
  async onCancelled(session: InterviewSessionRow): Promise<void> {
    if (!session.prepRunId) return;
    try {
      await this.d.aiService.cancelBlueprintRun(session.prepRunId);
    } catch (err) {
      this.d.log.warn(`blueprint cancel failed for session ${session.id}: ${errorMessage(err)}`);
    }
    await this.d.sessions.update(session.id, { prepRunId: null, prepRunStartedAt: null, prepRefreshing: false });
  }

  /** Start a run and attach it. Returns the run id, or null when the AI service could not be reached. */
  async start(session: InterviewSessionRow, trigger: PrepTrigger): Promise<string | null> {
    try {
      const request = await this.assemble(session, trigger);
      const { runId } = await this.d.aiService.startBlueprintRun(request);
      const attached = await this.d.sessions.attachRun(session.id, runId, trigger === "refresh" ? { prepRefreshing: true } : {});
      if (!attached) this.d.log.info(`blueprint run ${runId} not attached: session ${session.id} already has a run`);
      return runId;
    } catch (err) {
      this.d.log.warn(`blueprint start failed for session ${session.id} (${trigger}): ${errorMessage(err)}`);
      return null;
    }
  }

  /** Apply a finished run (or time out a stuck one). Called by the reconcile job for sessions with a run. */
  async collect(session: InterviewSessionRow): Promise<void> {
    const runId = session.prepRunId;
    if (!runId) return;
    let run: unknown;
    try {
      run = await this.d.aiService.getBlueprintRun(runId);
    } catch (err) {
      if (err instanceof UpstreamHttpError && err.status === 404) {
        // The run is gone (AI-service data reset): detach so the next tick starts afresh.
        await this.d.sessions.update(session.id, { prepRunId: null, prepRunStartedAt: null, prepRefreshing: false });
        return;
      }
      throw err;
    }
    const status = textOrNull(path(run, "status"));
    if (status === "running") {
      const started = session.prepRunStartedAt?.getTime() ?? Date.now();
      if (Date.now() - started > this.d.options.runTimeoutMinutes * 60_000) {
        await this.d.aiService.cancelBlueprintRun(runId).catch(() => undefined);
        await this.applyFailure(session, "timeout");
      }
      return;
    }
    if (status === "completed") return this.applySuccess(session, run);
    await this.applyFailure(session, textOrNull(path(run, "error", "code")) ?? (status === "cancelled" ? "cancelled" : "internal_error"));
  }

  private async applySuccess(session: InterviewSessionRow, run: unknown): Promise<void> {
    if (!["PREP_QUEUED", "PREP_READY", "PREP_FAILED"].includes(session.status)) {
      await this.d.sessions.update(session.id, { prepRunId: null, prepRunStartedAt: null, prepRefreshing: false });
      return;
    }
    // Stale guard (§5.3): inputs that changed while the run was going make its result obsolete.
    const current = await this.assemble(session, "reconcile");
    const runHash = textOrNull(path(run, "input_hash"));
    if (runHash !== current.input_hash) {
      this.d.log.info(`blueprint run ${session.prepRunId} superseded for session ${session.id}: inputs changed`);
      await this.d.sessions.update(session.id, { prepRunId: null, prepRunStartedAt: null });
      const fresh = await this.d.sessions.findById(session.id);
      if (fresh) await this.start(fresh, session.status === "PREP_READY" ? "refresh" : "reconcile");
      return;
    }
    const briefing = path(run, "briefing");
    const version = path(run, "blueprint_version");
    await this.d.sessions.update(session.id, {
      status: "PREP_READY",
      blueprintVersion: typeof version === "number" ? version : session.blueprintVersion,
      prepInputHash: runHash,
      prepBriefing: isObject(briefing) ? (briefing as InterviewSessionRow["prepBriefing"]) : session.prepBriefing,
      preparedAt: path(run, "cached") === true && session.preparedAt ? session.preparedAt : new Date(),
      prepErrorCode: null, prepRefreshing: false, prepRunId: null, prepRunStartedAt: null,
    });
  }

  private async applyFailure(session: InterviewSessionRow, code: string): Promise<void> {
    if (session.status === "PREP_READY") {
      // A failed refresh keeps the current blueprint; diagnostics has the run.
      this.d.log.warn(`blueprint refresh failed for session ${session.id}: ${code}`);
      await this.d.sessions.update(session.id, { prepRunId: null, prepRunStartedAt: null, prepRefreshing: false });
      return;
    }
    if (session.status === "PREP_QUEUED") {
      if (TRANSIENT_CODES.has(code) && this.autoRetryBudget(session) > 0 && this.slotIsFarEnough(session)) {
        // A dropped LLM reply or a stuck run: queue again quietly (the page keeps showing the steps).
        this.d.log.warn(`blueprint run for session ${session.id} failed (${code}); retrying automatically`);
        const now = Date.now();
        const fresh = now - (session.prepRetryWindowStart?.getTime() ?? 0) >= 3_600_000;
        const requeued = await this.d.sessions.update(session.id, {
          prepRunId: null, prepRunStartedAt: null, prepErrorCode: null,
          prepRetryCount: (fresh ? 0 : session.prepRetryCount) + 1, prepRetryWindowStart: fresh ? new Date(now) : session.prepRetryWindowStart,
        });
        if (requeued) await this.start(requeued, "retry");
        return;
      }
      await this.d.sessions.update(session.id, { status: "PREP_FAILED", prepErrorCode: code.slice(0, 64), prepRunId: null, prepRunStartedAt: null });
      return;
    }
    await this.d.sessions.update(session.id, { prepRunId: null, prepRunStartedAt: null, prepRefreshing: false });
  }

  /** Automatic re-runs left this hour (the candidate's own retries count against the same window). */
  private autoRetryBudget(session: InterviewSessionRow): number {
    const fresh = Date.now() - (session.prepRetryWindowStart?.getTime() ?? 0) >= 3_600_000;
    return AUTO_RETRIES - (fresh ? 0 : session.prepRetryCount);
  }

  /** Re-running only makes sense while the slot is still beyond the refresh cutoff. */
  private slotIsFarEnough(session: InterviewSessionRow): boolean {
    return (session.scheduledAt?.getTime() ?? 0) - Date.now() > this.d.options.refreshCutoffMinutes * 60_000;
  }

  /** Re-prepare a ready session whose inputs changed (reconcile, every Nth tick). */
  async refreshIfChanged(session: InterviewSessionRow): Promise<boolean> {
    const req = await this.assemble(session, "refresh");
    if (req.input_hash === session.prepInputHash) return false;
    await this.start(session, "refresh");
    return true;
  }

  /** Candidate retry after PREP_FAILED: at most `retryLimitPerHour` per rolling hour (server-enforced). */
  async retry(session: InterviewSessionRow): Promise<InterviewSessionRow> {
    if (session.status !== "PREP_FAILED") throw new PrepRetryError(409, "prep_not_failed", "this interview is not in a failed state");
    const now = Date.now();
    const windowStart = session.prepRetryWindowStart?.getTime() ?? 0;
    const fresh = now - windowStart >= 3_600_000;
    const count = fresh ? 0 : session.prepRetryCount;
    if (count >= this.d.options.retryLimitPerHour) {
      const minutes = Math.max(1, Math.ceil((windowStart + 3_600_000 - now) / 60_000));
      throw new PrepRetryError(429, "prep_retry_limited", `Too many retries. Try again in ${minutes} min.`);
    }
    const updated = await this.d.sessions.transitionStatus(session.id, "PREP_FAILED", "PREP_QUEUED", {
      prepErrorCode: null, prepRetryCount: count + 1, prepRetryWindowStart: fresh ? new Date(now) : session.prepRetryWindowStart,
    });
    if (!updated) throw new PrepRetryError(409, "prep_not_failed", "this interview is not in a failed state");
    this.d.background.run(`blueprint-retry-${session.id}`, () => this.start(updated, "retry"));
    return updated;
  }

  /** Live progress for the session page while preparing or refreshing; null when unavailable. */
  async liveSteps(session: InterviewSessionRow): Promise<{ step: string | null; steps: PrepStep[] } | null> {
    if (!session.prepRunId) return null;
    try {
      const run = await this.d.aiService.getBlueprintRun(session.prepRunId);
      const steps = items(path(run, "steps")).filter(isObject).map((s) => ({
        id: String(s.id), state: (["done", "active", "failed"].includes(String(s.state)) ? s.state : "pending") as PrepStep["state"],
        elapsedMs: typeof s.elapsed_ms === "number" ? s.elapsed_ms : null,
      }));
      return { step: textOrNull(path(run, "stage")), steps };
    } catch {
      return null;
    }
  }

  /** Record the problems of the blueprint a session went live with (no repeats on later blueprints). */
  async recordSeen(session: InterviewSessionRow): Promise<void> {
    try {
      const bp = await this.d.aiService.getSessionBlueprint(session.id, session.blueprintVersion ?? undefined);
      const problems = items(path(bp, "slots")).map((s) => ({ slug: textOrNull(path(s, "problem", "slug")), roundType: textOrNull(path(s, "problem", "round_type")) ?? session.roundType }))
        .filter((p): p is { slug: string; roundType: string } => p.slug !== null);
      await this.d.seen.record(session.candidateId, session.id, problems);
    } catch (err) {
      this.d.log.warn(`could not record seen problems for session ${session.id}: ${errorMessage(err)}`);
    }
  }
}
