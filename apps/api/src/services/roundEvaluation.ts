import type { InterviewSessionRow } from "../db/pg/schema.js";
import { codeStandardFor, passMark, retakeAfter, type CodeStandard, type EvalOutcome } from "../domain/evaluation.js";
import { sessionRoundMinutes } from "../domain/liveRound.js";
import type { AiServiceClient } from "../integrations/aiService/client.js";
import type { EvaluationRunRequest } from "../integrations/aiService/types.js";
import { errorMessage } from "../lib/errors.js";
import { UpstreamHttpError } from "../lib/http.js";
import { isObject, items, path, textOrNull } from "../lib/json.js";
import type { Logger } from "../lib/logger.js";
import type { BlueprintSeenRepository, RoundReportRepository } from "../repositories/mongo.js";
import type { CompanyRepository, InterviewSessionRepository, LoopRepository } from "../repositories/pg.js";
import { type BlueprintPrepService, resolveRoundDifficulty } from "./blueprintPrep.js";
import { InterviewSessionError } from "./interviewSessions.js";

/**
 * Round evaluation, API side (docs/superpowers/specs/2026-10-18-post-interview-report-design.md §8.6, §10, §11).
 *
 * When a round completes, start an AI-service evaluation run (immediately, plus the reconcile job's safety net),
 * poll it, store the report in Mongo `round_reports` and the summary + gating columns (score, outcome, verdict,
 * retake_after) on the session. Owner rule: a result is always available. A failed evaluation is never final: it
 * keeps `eval_status = failed` between attempts, with no cooldown (the candidate may retake freely), and is retried every hour
 * for as long as it takes (`stale_report`, a dispute against an outdated report, is the one exception). An admin can also re-run. Disputes start a `dispute` run on a ready report; the session
 * stays `ready` (gating is never re-locked) and the run is tracked by `eval_run_id` until it completes.
 */

export interface RoundEvaluationOptions {
  runTimeoutMinutes: number;
  /** Automatic re-runs after a transient failure, per rolling hour. */
  autoRetries: number;
}

export interface RoundEvaluationDeps {
  sessions: InterviewSessionRepository;
  loops: LoopRepository;
  companies: CompanyRepository;
  reports: RoundReportRepository;
  seen: BlueprintSeenRepository;
  prep: BlueprintPrepService;
  aiService: AiServiceClient;
  log: Logger;
  options: RoundEvaluationOptions;
}

export type EvaluationTrigger = EvaluationRunRequest["trigger"];

/**
 * Failures that are the infrastructure's, not the inputs' ("interrupted": the AI service restarted mid-run;
 * "live_not_final": the interviewer worker had not written its final record of the round yet).
 */
export const TRANSIENT_EVAL_CODES = new Set(["llm_unavailable", "timeout", "interrupted", "live_not_final", "internal_error"]);

/** The one failure never retried: a dispute run against a report that was replaced meanwhile. */
export const FINAL_EVAL_CODES = new Set(["stale_report"]);

/** A start that failed (the AI service unreachable, the request not assembled). After this many in a row: wait for the next hour. */
export const START_FAILED = "start_failed";
export const MAX_START_FAILURES = 3;

export const DISPUTE_WINDOW_DAYS = 14;
export const MAX_DISPUTES = 3;
export const MAX_DISPUTE_REASON = 500;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export interface RecheckTarget { type: "question" | "area"; id: string }

export type ReportView =
  | { status: "evaluating" | "failed" | "legacy" }
  | { status: "ready"; report: Record<string, any>; recheckPending: boolean; recheckTarget: RecheckTarget | null };

export interface DisputeBody {
  target: { type: "question" | "area"; id: string };
  reason: string;
}

const TECHNICAL_REPORT_REASON = "The round ended because of a technical problem, so it was not scored. You can retake it right away.";

export class RoundEvaluationService {
  constructor(private readonly d: RoundEvaluationDeps) {}

  // ---------------------------------------------------------------- inputs

  /** Sessions booked before the grading snapshot get it computed once, here, and stored. The stored snapshot always wins. */
  private async withSnapshot(session: InterviewSessionRow): Promise<InterviewSessionRow> {
    if (session.passMark !== null && session.codeStandard !== null) return session;
    const company = session.company ? await this.d.companies.findBySlug(session.company) : null;
    const loop = session.loopId ? await this.d.loops.findOwned(session.loopId, session.candidateId) : null;
    const tier = company?.tier ?? null;
    const override = company?.codeStandard;
    const codeOverride: CodeStandard | null = override === "runnable" || override === "near_runnable" || override === "pseudo_ok" ? override : null;
    const difficulty = resolveRoundDifficulty(session, session.practicePrep?.companyBrief ?? null, loop);
    const patch = {
      passMark: session.passMark ?? passMark({ level: session.level, tier, difficulty }),
      codeStandard: session.codeStandard ?? codeStandardFor(tier, company?.businessModel ?? null, codeOverride),
      companyTier: session.companyTier ?? tier,
      roundDifficulty: session.roundDifficulty ?? difficulty,
    };
    return (await this.d.sessions.applyEvaluation(session.id, patch)) ?? { ...session, ...patch };
  }

  /** Latest ready report of the previous attempt on the same loop node: `{area key: score}`, or null. */
  private async previousAreas(session: InterviewSessionRow): Promise<Record<string, number> | null> {
    if (!session.loopId || !session.nodeId) return null;
    const attempts = (await this.d.sessions.findAllByCandidateIdOrderByScheduledAtDesc(session.candidateId))
      .filter((s) => s.id !== session.id && s.loopId === session.loopId && s.nodeId === session.nodeId
        && s.evalStatus === "ready" && s.scheduledAt.getTime() < session.scheduledAt.getTime());
    const previous = attempts[0]; // newest first
    if (!previous) return null;
    const latest = await this.d.reports.latest(previous.id);
    const areas = items(path(latest?.report, "areas")).filter(isObject);
    const out: Record<string, number> = {};
    for (const a of areas) if (typeof a.key === "string" && typeof a.score === "number") out[a.key] = a.score;
    return Object.keys(out).length ? out : null;
  }

  private async assemble(session: InterviewSessionRow, trigger: EvaluationTrigger, dispute: EvaluationRunRequest["dispute"] = null): Promise<EvaluationRunRequest> {
    const s = await this.withSnapshot(session);
    const loop = s.loopId ? await this.d.loops.findOwned(s.loopId, s.candidateId) : null;
    const [candidateProfile, exclusions, previousAreas] = await Promise.all([
      this.d.prep.candidateProfile(s.candidateId),
      this.d.seen.slugsFor(s.candidateId),
      this.previousAreas(s),
    ]);
    return {
      session_id: s.id,
      candidate_id: s.candidateId,
      trigger,
      meta: {
        company: s.company, role: s.role, level: s.level, round_type: s.roundType,
        round_minutes: s.prepBriefing?.duration_mins ?? sessionRoundMinutes(s),
        pass_mark: s.passMark!, code_standard: (s.codeStandard ?? "near_runnable") as CodeStandard,
        company_tier: s.companyTier, difficulty: s.roundDifficulty,
        official: loop?.kind === "official",
      },
      candidate_profile: candidateProfile,
      previous_areas: previousAreas,
      exclusions,
      dispute,
      ended_reason: s.endedReason ?? null,
    };
  }

  // ---------------------------------------------------------------- lifecycle

  /**
   * Start a run and attach it. A failed start leaves the session pending (`start_failed`) and the reconcile job tries again;
   * after MAX_START_FAILURES in a row the evaluation waits as `failed` (free retake) and starts again an hour later, indefinitely.
   */
  async start(session: InterviewSessionRow, trigger: EvaluationTrigger): Promise<void> {
    try {
      if (session.evalRunId) return;
      let current = session;
      if (session.evalStatus === "failed") {
        // A failed round whose rolling hour passed: spend one automatic retry of the new window.
        const now = Date.now();
        const fresh = now - (session.evalRetryWindowStart?.getTime() ?? 0) >= HOUR_MS;
        current = (await this.d.sessions.applyEvaluation(session.id, {
          evalStatus: "pending", evalAttempts: (fresh ? 0 : session.evalAttempts) + 1,
          evalRetryWindowStart: fresh ? new Date(now) : session.evalRetryWindowStart,
        })) ?? session;
      }
      const request = await this.assemble(current, trigger);
      const { run_id: runId } = await this.d.aiService.startEvaluationRun(request);
      const attached = await this.d.sessions.attachEvalRun(session.id, runId);
      if (!attached) this.d.log.info(`evaluation run ${runId} not attached: session ${session.id} already has a run`);
    } catch (err) {
      this.d.log.warn(`evaluation start failed for session ${session.id} (${trigger}): ${errorMessage(err)}`);
      await this.recordStartFailure(session.id).catch((e) => this.d.log.warn(`recording the start failure of session ${session.id} failed: ${errorMessage(e)}`));
    }
  }

  /** Count consecutive start failures on the session; the third one parks the evaluation as failed (no cooldown) until the next hour. */
  private async recordStartFailure(sessionId: string): Promise<void> {
    const s = await this.d.sessions.findById(sessionId);
    // Only a round still waiting for a run: never one that got a run meanwhile or turned out to be a technical end.
    if (!s || s.status !== "COMPLETED" || s.evalRunId || (s.evalStatus !== "pending" && s.evalStatus !== "failed")) return;
    const failures = (s.evalErrorCode === START_FAILED ? s.evalAttempts : 0) + 1;
    if (failures >= MAX_START_FAILURES) {
      this.d.log.warn(`evaluation of session ${sessionId} could not start ${failures} times in a row; trying again in an hour`);
      await this.d.sessions.applyEvaluation(sessionId, {
        evalStatus: "failed", evalErrorCode: START_FAILED, retakeAfter: null,
        evalAttempts: Math.max(failures, this.d.options.autoRetries), evalRetryWindowStart: new Date(),
      });
      return;
    }
    await this.d.sessions.applyEvaluation(sessionId, { evalStatus: "pending", evalErrorCode: START_FAILED, evalAttempts: failures });
  }

  /**
   * Admin re-run of a completed round: reset the evaluation bookkeeping and start a fresh `admin` run. Unlike `start` it
   * throws on failure (the admin sees why); the session is left pending, so the reconcile job also retries it.
   */
  async rerun(sessionId: string): Promise<{ runId: string }> {
    const s = await this.d.sessions.findById(sessionId);
    if (!s) throw InterviewSessionError.notFound();
    if (s.status !== "COMPLETED") throw InterviewSessionError.conflict("session_not_completed", "only a completed round can be re-evaluated");
    const reset = (await this.d.sessions.applyEvaluation(s.id, {
      evalRunId: null, evalRunStartedAt: null, evalStatus: "pending", evalErrorCode: null, evalAttempts: 0, evalRetryWindowStart: null,
    })) ?? s;
    const request = await this.assemble(reset, "admin");
    const { run_id: runId } = await this.d.aiService.startEvaluationRun(request);
    const attached = await this.d.sessions.attachEvalRun(s.id, runId);
    if (!attached) this.d.log.info(`evaluation run ${runId} not attached: session ${s.id} already has a run`);
    return { runId };
  }

  /** Apply a finished run (or time out a stuck one). Called by the reconcile job for sessions with a run. */
  async collect(session: InterviewSessionRow): Promise<void> {
    const runId = session.evalRunId;
    if (!runId) return;
    const dispute = session.evalStatus === "ready";
    let run;
    try {
      run = await this.d.aiService.getEvaluationRun(runId);
    } catch (err) {
      if (err instanceof UpstreamHttpError && err.status === 404) {
        // The run is gone (AI-service data reset): detach so the next tick starts afresh.
        await this.d.sessions.applyEvaluation(session.id, { evalRunId: null, evalRunStartedAt: null, ...(dispute ? {} : { evalStatus: "pending" }) });
        return;
      }
      throw err;
    }
    if (run.status === "running") {
      const started = session.evalRunStartedAt?.getTime() ?? Date.now();
      if (Date.now() - started > this.d.options.runTimeoutMinutes * 60_000) {
        await this.d.aiService.cancelEvaluationRun(runId).catch(() => undefined);
        await this.applyFailure(session, "timeout", dispute);
      }
      return;
    }
    if (run.status === "completed" && run.result) return dispute ? this.applyDispute(session, run.result) : this.applySuccess(session, run.result);
    const code = textOrNull(run.error?.code) ?? (run.status === "cancelled" ? "cancelled" : "internal_error");
    await this.applyFailure(session, code, dispute);
  }

  private async fetchReport(sessionId: string, version: number): Promise<{ version: number; report: Record<string, any> }> {
    const doc = await this.d.aiService.getSessionEvaluation(sessionId, version);
    const inner = isObject(doc?.report) ? doc.report : doc;
    if (!isObject(inner)) throw new Error(`evaluation ${sessionId} v${version} has no report`);
    return { version, report: { ...inner, version } };
  }

  private async applySuccess(session: InterviewSessionRow, result: NonNullable<Awaited<ReturnType<AiServiceClient["getEvaluationRun"]>>["result"]>): Promise<void> {
    const { version, report } = await this.fetchReport(session.id, result.version);
    await this.d.reports.save(session.id, session.candidateId, version, report); // idempotent: a failure after this re-saves harmlessly
    const outcome = result.outcome as EvalOutcome;
    const now = new Date();
    const mark = session.passMark ?? result.pass_mark;
    await this.d.sessions.applyEvaluation(session.id, {
      evalStatus: outcome === "unscorable" ? "unscorable" : "ready",
      score: result.score, outcome, verdict: result.verdict,
      retakeAfter: retakeAfter(outcome, result.score, mark, now),
      evalVersion: textOrNull(report.eval_version)?.slice(0, 16) ?? String(version),
      evaluatedAt: now,
      evalRunId: null, evalRunStartedAt: null, evalErrorCode: null,
    });
  }

  /** A completed dispute re-check: a new report version; the outcome and cooldown are recomputed (a flip to passed clears it). */
  private async applyDispute(session: InterviewSessionRow, result: NonNullable<Awaited<ReturnType<AiServiceClient["getEvaluationRun"]>>["result"]>): Promise<void> {
    const { version, report } = await this.fetchReport(session.id, result.version);
    await this.d.reports.save(session.id, session.candidateId, version, report);
    const outcome = result.outcome as EvalOutcome;
    const mark = session.passMark ?? result.pass_mark;
    // The cooldown counts from the original evaluation: a dispute never restarts the clock.
    const retake = outcome === "passed" ? null : retakeAfter(outcome, result.score, mark, session.evaluatedAt ?? new Date());
    await this.d.sessions.applyEvaluation(session.id, {
      score: result.score, outcome, verdict: result.verdict, retakeAfter: retake,
      evalVersion: textOrNull(report.eval_version)?.slice(0, 16) ?? session.evalVersion,
      evalRunId: null, evalRunStartedAt: null,
    });
  }

  private async applyFailure(session: InterviewSessionRow, code: string, dispute: boolean): Promise<void> {
    if (dispute) {
      // The report stays as it was; the candidate may dispute again.
      this.d.log.warn(`evaluation dispute run failed for session ${session.id}: ${code}`);
      await this.d.sessions.applyEvaluation(session.id, { evalRunId: null, evalRunStartedAt: null });
      return;
    }
    const now = Date.now();
    const fresh = now - (session.evalRetryWindowStart?.getTime() ?? 0) >= HOUR_MS;
    const used = fresh ? 0 : session.evalAttempts;
    if (TRANSIENT_EVAL_CODES.has(code) && used < this.d.options.autoRetries) {
      this.d.log.warn(`evaluation run for session ${session.id} failed (${code}); retrying automatically`);
      await this.d.sessions.applyEvaluation(session.id, {
        evalStatus: "pending", evalErrorCode: code.slice(0, 64), evalRunId: null, evalRunStartedAt: null,
        evalAttempts: used + 1, evalRetryWindowStart: fresh ? new Date(now) : session.evalRetryWindowStart,
      });
      return;
    }
    // Not final: `failed` shows the "taking longer" state and frees the retake (no cooldown), and the reconcile job starts the run again
    // once the rolling hour has passed. A code that is not transient (invalid grades, missing inputs) skips the fast retries.
    const cap = TRANSIENT_EVAL_CODES.has(code) ? used : Math.max(used, this.d.options.autoRetries);
    await this.d.sessions.applyEvaluation(session.id, {
      evalStatus: "failed", evalErrorCode: code.slice(0, 64), evalRunId: null, evalRunStartedAt: null,
      retakeAfter: null, evalAttempts: cap, evalRetryWindowStart: fresh ? new Date(now) : session.evalRetryWindowStart,
    });
  }

  // ---------------------------------------------------------------- candidate views

  async report(candidateId: string, sessionId: string): Promise<ReportView> {
    const s = await this.requireOwned(candidateId, sessionId);
    switch (s.evalStatus) {
      case "pending":
      case "running":
        return { status: "evaluating" };
      case "failed":
        return { status: "failed" };
      case "ready":
      case "unscorable": {
        const latest = await this.d.reports.latest(s.id);
        // A dispute re-check is in flight while a ready report has a run attached; its target was remembered when it started.
        const recheckPending = s.evalStatus === "ready" && !!s.evalRunId;
        const recheckTarget = recheckPending ? (latest?.recheck ?? null) : null;
        if (latest) {
          return { status: "ready", report: { ...(isObject(latest.report) ? latest.report : {}), version: latest.version }, recheckPending, recheckTarget };
        }
        if (s.evalStatus === "unscorable") {
          // A technical end has no run, hence no AI-service report: say why in one plain sentence.
          return {
            status: "ready", report: { outcome: "unscorable", unscorable_reason: TECHNICAL_REPORT_REASON, disputes: [], version: 0 },
            recheckPending: false, recheckTarget: null,
          };
        }
        return { status: "evaluating" };
      }
      default:
        return { status: "legacy" };
    }
  }

  async dispute(candidateId: string, sessionId: string, body: DisputeBody): Promise<{ status: "rechecking" }> {
    const type = body?.target?.type;
    const targetId = typeof body?.target?.id === "string" ? body.target.id.trim() : "";
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if ((type !== "question" && type !== "area") || targetId === "" || targetId.length > 200) {
      throw InterviewSessionError.badRequest("invalid_dispute", "choose a question or an area to dispute");
    }
    if (reason === "" || reason.length > MAX_DISPUTE_REASON) {
      throw InterviewSessionError.badRequest("invalid_dispute", `give a reason of 1 to ${MAX_DISPUTE_REASON} characters`);
    }
    const s = await this.requireOwned(candidateId, sessionId);
    if (s.evalStatus !== "ready") throw InterviewSessionError.conflict("report_not_ready", "this round has no graded report to dispute");
    const [first, latest] = await Promise.all([this.d.reports.first(s.id), this.d.reports.latest(s.id)]);
    if (!first || !latest) throw InterviewSessionError.conflict("report_not_ready", "this round has no graded report to dispute");
    if (Date.now() - first.createdAt.getTime() > DISPUTE_WINDOW_DAYS * DAY_MS) {
      throw InterviewSessionError.conflict("dispute_window_closed", `disputes are open for ${DISPUTE_WINDOW_DAYS} days after the report`);
    }
    const known = items(path(latest.report, "disputes")).filter(isObject);
    if (known.length >= MAX_DISPUTES) throw InterviewSessionError.conflict("dispute_limit", `a report can be disputed ${MAX_DISPUTES} times`);
    if (s.evalRunId || known.some((x) => x.target_type === type && x.target_id === targetId)) {
      throw InterviewSessionError.conflict("dispute_exists", "this part of the report is already being re-checked or was disputed");
    }
    const exists = type === "question"
      ? items(path(latest.report, "questions")).some((q) => path(q, "id") === targetId)
      : items(path(latest.report, "areas")).some((a) => path(a, "key") === targetId);
    if (!exists) throw InterviewSessionError.badRequest("invalid_dispute", "that part is not in this report");

    const request = await this.assemble(s, "dispute", { target_type: type, target_id: targetId, reason, report_version: latest.version });
    const { run_id: runId } = await this.d.aiService.startEvaluationRun(request);
    // The report stays `ready` while the re-check runs; the run id is what the reconcile job polls.
    await this.d.sessions.applyEvaluation(s.id, { evalRunId: runId, evalRunStartedAt: new Date() });
    await this.d.reports.markRecheck(s.id, latest.version, { type, id: targetId });
    return { status: "rechecking" };
  }

  private async requireOwned(candidateId: string, sessionId: string): Promise<InterviewSessionRow> {
    const s = await this.d.sessions.findByIdAndCandidateId(sessionId, candidateId);
    if (!s) throw InterviewSessionError.notFound();
    return s;
  }
}
