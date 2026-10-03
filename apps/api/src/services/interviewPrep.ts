import type { InterviewSessionRow } from "../db/pg/schema.js";
import { EMPTY_LINKS } from "../domain/candidateProfile.js";
import type { AiServiceClient } from "../integrations/aiService/client.js";
import type { GenerateInterviewPlanRequest, PlanCandidateProfile, PlanCodingProfile } from "../integrations/aiService/types.js";
import { type BackgroundTasks, sleep } from "../lib/background.js";
import { errorMessage } from "../lib/errors.js";
import { UpstreamHttpError } from "../lib/http.js";
import { path, textOrNull } from "../lib/json.js";
import type { Logger } from "../lib/logger.js";
import type { InterviewSessionRepository, JobDescriptionRepository } from "../repositories/pg.js";
import type { CandidateProfileService } from "./candidateProfileService.js";
import type { CodingSignalsProvider } from "./codingSignals.js";
import type { CompanyEnrichmentService } from "./companyEnrichment.js";

/** Terminal prep failure carrying the `prep_error` code recorded on the session. */
class PrepGenerationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Build the ai-service candidate profile block (profile may be absent — the plan is still buildable). */
export async function resolvePlanProfile(
  candidateProfiles: CandidateProfileService,
  codingSignals: CodingSignalsProvider,
  candidateId: string | null,
): Promise<PlanCandidateProfile> {
  if (!candidateId) return emptyPlanProfile(null);
  const [coding, p] = await Promise.all([codingSignals.forUser(candidateId), candidateProfiles.getProfile(candidateId)]);
  if (!p) return emptyPlanProfile(coding);
  return {
    fullName: p.fullName,
    headline: p.headline,
    targetRole: p.targetRole,
    education: p.education,
    experience: p.experience,
    projects: p.projects,
    skills: p.skills,
    achievements: p.achievements,
    links: p.detectedLinks,
    codingProfile: coding,
  };
}

function emptyPlanProfile(coding: PlanCodingProfile | null): PlanCandidateProfile {
  return {
    fullName: null,
    headline: null,
    targetRole: null,
    education: [],
    experience: [],
    projects: [],
    skills: [],
    achievements: [],
    links: { ...EMPTY_LINKS },
    codingProfile: coding,
  };
}

/**
 * Builds interview prep for one session: assemble the ai-service request (session context + JD +
 * candidate profile), start a plan run, poll it to completion, and record PREP_READY (with the plan
 * reference) or PREP_FAILED (with a stable error code). Safe to call repeatedly — the ai-service
 * caches on the input hash.
 */
export class InterviewPrepService {
  constructor(
    private readonly sessions: InterviewSessionRepository,
    private readonly jds: JobDescriptionRepository,
    private readonly candidateProfiles: CandidateProfileService,
    private readonly codingSignals: CodingSignalsProvider,
    private readonly aiService: AiServiceClient,
    private readonly background: BackgroundTasks,
    private readonly log: Logger,
    private readonly opts: { planPollIntervalMs: number; planMaxWaitMs: number },
    private readonly enrichment?: CompanyEnrichmentService,
  ) {}

  /** Fire-and-forget generation (manual regenerate returns immediately). */
  generateInBackground(sessionId: string): void {
    this.background.run(`prep:${sessionId}`, () => this.generatePrep(sessionId));
  }

  /**
   * PREP_QUEUED → start ai-service run → poll → PREP_READY | PREP_FAILED. Never throws for
   * generation failures (they are recorded on the session).
   *
   * Fire-and-poll rather than one blocking call: plan generation fans out several slow LLM calls,
   * and a single long request used to trip the client timeout and wrongly fail the session.
   */
  async generatePrep(sessionId: string): Promise<void> {
    const session = await this.sessions.findById(sessionId);
    if (!session) {
      this.log.warn(`prep: session ${sessionId} no longer exists — skipping`);
      return;
    }
    await this.sessions.update(sessionId, { status: "PREP_QUEUED", prepError: null });
    try {
      const body = await this.assembleRequest(session);
      const runId = await this.aiService.startInterviewPlan(body);
      await this.applySuccess(sessionId, await this.awaitPlan(runId));
    } catch (err) {
      if (err instanceof PrepGenerationError) {
        await this.applyFailure(sessionId, err.code, err.message);
      } else if (err instanceof UpstreamHttpError) {
        await this.applyFailure(sessionId, `prep_generation_upstream_${err.status}`, err.message);
      } else {
        await this.applyFailure(sessionId, "prep_generation_failed", errorMessage(err));
      }
    }
  }

  /** The ai-service request body. Exported via the service for tests to assert its shape. */
  async assembleRequest(session: InterviewSessionRow): Promise<GenerateInterviewPlanRequest> {
    const jd = await this.jds.findById(session.jobDescriptionId);
    if (!jd) throw new Error(`job description ${session.jobDescriptionId} gone for session ${session.id}`);
    const companyBrief = await this.enrichment?.briefForJd(jd.id);
    return {
      session: {
        sessionId: session.id,
        candidateId: session.candidateId,
        company: session.company,
        role: session.role,
        level: session.level,
        specialization: session.specialization,
        roundType: session.roundType,
      },
      jobDescription: { id: jd.id, title: jd.title, description: jd.description, techStack: jd.techStack },
      candidateProfile: await resolvePlanProfile(this.candidateProfiles, this.codingSignals, session.candidateId),
      ...(companyBrief ? { companyBrief } : {}),
    };
  }

  /**
   * Poll until terminal: the plan doc on `completed`; PrepGenerationError on `failed` (carrying the
   * ai-service error code) or when planMaxWaitMs runs out while still `running`.
   */
  private async awaitPlan(runId: string): Promise<unknown> {
    const deadline = Date.now() + this.opts.planMaxWaitMs;
    for (;;) {
      const snap = await this.aiService.getInterviewPlanRun(runId);
      const status = textOrNull(path(snap, "status"));
      if (status === "completed") return path(snap, "plan");
      if (status === "failed") {
        const code = textOrNull(path(snap, "error", "code"));
        throw new PrepGenerationError(`prep_generation_${code ?? "failed"}`, textOrNull(path(snap, "error", "message")) ?? "");
      }
      if (Date.now() >= deadline) {
        throw new PrepGenerationError("prep_generation_timeout", `plan not ready within ${this.opts.planMaxWaitMs}ms (run ${runId})`);
      }
      await sleep(this.opts.planPollIntervalMs);
    }
  }

  private async applySuccess(sessionId: string, plan: unknown): Promise<void> {
    const planVersion = textOrNull(path(plan, "provenance", "planVersion"));
    const inputHash = textOrNull(path(plan, "provenance", "inputHash"));
    await this.sessions.update(sessionId, { status: "PREP_READY", planVersion, inputHash, prepError: null });
    this.log.info(`prep READY for session ${sessionId} (planVersion=${planVersion}, inputHash=${inputHash})`);
  }

  private async applyFailure(sessionId: string, code: string, detail: string): Promise<void> {
    await this.sessions.update(sessionId, { status: "PREP_FAILED", prepError: code });
    this.log.warn(`prep FAILED for session ${sessionId} (${code}): ${detail}`);
  }
}
