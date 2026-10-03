import type { InterviewSessionRow } from "../db/pg/schema.js";
import { DEFAULT_ROUND_TYPE, optionalRoundType, type RoundType, type SessionStatus } from "../domain/enums.js";
import { ApiError } from "../lib/errors.js";
import { isObject } from "../lib/json.js";
import type {
  CompanyRepository,
  CompanyRoleConfigRepository,
  InterviewSessionRepository,
  JobDescriptionRepository,
} from "../repositories/pg.js";
import type { InterviewPrepService } from "./interviewPrep.js";
import type { CompanyEnrichmentService } from "./companyEnrichment.js";

/** A booking/session error carrying the HTTP status + the stable code the frontend keys on. */
export class InterviewSessionError extends ApiError {
  static notFound() {
    return new InterviewSessionError(404, "session_not_found", "interview session not found");
  }
  static badRequest(code: string, message: string) {
    return new InterviewSessionError(400, code, message);
  }
  static conflict(code: string, message: string) {
    return new InterviewSessionError(409, code, message);
  }
}

/**
 * Candidate-facing view of a session (mirrors `InterviewSession` in the contract). `planReady` is
 * the only prep signal exposed — plan CONTENTS are the interviewer's material and never returned.
 */
export interface InterviewSessionResponse {
  id: string;
  candidateId: string;
  jobDescriptionId: string;
  company: string;
  companyName: string | null;
  role: string;
  level: string;
  specialization: string | null;
  roundType: RoundType;
  scheduledAt: Date;
  timezone: string;
  status: SessionStatus;
  planReady: boolean;
  planVersion: string | null;
  inputHash: string | null;
  prepError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toSessionResponse(s: InterviewSessionRow, companyName: string | null): InterviewSessionResponse {
  return {
    id: s.id,
    candidateId: s.candidateId,
    jobDescriptionId: s.jobDescriptionId,
    company: s.company,
    companyName,
    role: s.role,
    level: s.level,
    specialization: s.specialization,
    roundType: s.roundType,
    scheduledAt: s.scheduledAt,
    timezone: s.timezone,
    status: s.status,
    planReady: s.status === "PREP_READY",
    planVersion: s.planVersion,
    inputHash: s.inputHash,
    prepError: s.prepError,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

/** Parsed `CreateInterviewSessionRequest`. roundType is optional (the platform assigns it). */
export interface CreateSessionRequest {
  jobDescriptionId: string | null;
  roundType: RoundType | null;
  scheduledAt: Date | null;
  timezone: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parse the booking body with the same leniency Jackson had (bad UUID/date/round → 400). */
export function parseCreateSessionRequest(body: unknown): CreateSessionRequest {
  const b = isObject(body) ? body : {};
  const jd = b.jobDescriptionId;
  if (jd !== undefined && jd !== null && (typeof jd !== "string" || !UUID_RE.test(jd))) {
    throw InterviewSessionError.badRequest("session_bad_request", "jobDescriptionId must be a UUID");
  }
  let scheduledAt: Date | null = null;
  if (b.scheduledAt !== undefined && b.scheduledAt !== null) {
    scheduledAt = typeof b.scheduledAt === "string" || typeof b.scheduledAt === "number" ? new Date(b.scheduledAt) : new Date(NaN);
    if (Number.isNaN(scheduledAt.getTime())) {
      throw InterviewSessionError.badRequest("session_bad_request", "scheduledAt must be an ISO-8601 instant");
    }
  }
  return {
    jobDescriptionId: typeof jd === "string" ? jd.toLowerCase() : null,
    roundType: optionalRoundType(b.roundType),
    scheduledAt,
    timezone: typeof b.timezone === "string" ? b.timezone : null,
  };
}

/**
 * Interview session booking + read (Pipeline 1). Booking validates that the JD resolves to a real,
 * enabled company/role/level and leaves the session SCHEDULED — the prep job builds the plan later.
 */
export class InterviewSessionService {
  constructor(
    private readonly sessions: InterviewSessionRepository,
    private readonly jds: JobDescriptionRepository,
    private readonly roleConfigs: CompanyRoleConfigRepository,
    private readonly companies: CompanyRepository,
    private readonly prep: InterviewPrepService,
    private readonly enrichment?: CompanyEnrichmentService,
  ) {}

  async createSession(candidateId: string, req: CreateSessionRequest): Promise<InterviewSessionResponse> {
    if (!req.jobDescriptionId) {
      throw InterviewSessionError.badRequest("session_jd_required", "jobDescriptionId is required");
    }
    // The candidate does not pick the round — every booking starts on the first round for now.
    // A round sent by a trusted caller (e.g. the admin bench) is still honoured.
    if (!req.scheduledAt) {
      throw InterviewSessionError.badRequest("session_slot_required", "scheduledAt is required");
    }
    const timezone = (req.timezone ?? "").trim();
    if (timezone === "") {
      throw InterviewSessionError.badRequest("session_timezone_required", "timezone is required");
    }
    // Defence in depth: the UI disables past slots.
    if (req.scheduledAt.getTime() < Date.now()) {
      throw InterviewSessionError.badRequest("session_slot_in_past", "the selected slot is in the past");
    }

    const jd = await this.jds.findById(req.jobDescriptionId);
    if (!jd || !jd.active) throw InterviewSessionError.badRequest("session_jd_not_found", "job description not found");
    const manual = await this.enrichment?.briefForJd(jd.id);
    const roundType = req.roundType ?? manual?.final_experience.rounds[0]?.type ?? DEFAULT_ROUND_TYPE;

    // The JD must map to a configured, enabled company/role/level — the key the brief + question
    // bank are built on.
    const config = await this.roleConfigs.findByCompanyAndRoleAndLevel(jd.company, jd.role, jd.level);
    if (!config) {
      throw InterviewSessionError.badRequest("session_role_not_configured", "this job description is not a configured interview target");
    }
    if (!config.enabled) {
      throw InterviewSessionError.badRequest("session_role_disabled", "interviews for this role are not currently available");
    }

    const session = await this.sessions.insert({
      candidateId,
      jobDescriptionId: jd.id,
      company: jd.company,
      role: jd.role,
      level: jd.level,
      specialization: jd.specialization,
      roundType,
      scheduledAt: req.scheduledAt,
      timezone,
      status: "SCHEDULED",
    });
    return this.toResponse(session);
  }

  async listSessions(candidateId: string): Promise<{ sessions: InterviewSessionResponse[] }> {
    const rows = await this.sessions.findAllByCandidateIdOrderByScheduledAtDesc(candidateId);
    const names = await this.companyNames(rows.map((r) => r.company));
    return { sessions: rows.map((r) => toSessionResponse(r, names.get(r.company) ?? null)) };
  }

  async getSession(candidateId: string, sessionId: string): Promise<InterviewSessionResponse> {
    return this.toResponse(await this.requireOwned(candidateId, sessionId));
  }

  /**
   * Re-queue prep (retry after PREP_FAILED, or refresh): PREP_QUEUED now, generation in the
   * background. Idempotent — the AI service returns the cached plan when inputs are unchanged.
   */
  async regenerate(candidateId: string, sessionId: string): Promise<InterviewSessionResponse> {
    await this.requireOwned(candidateId, sessionId);
    const updated = await this.sessions.update(sessionId, { status: "PREP_QUEUED", prepError: null });
    if (!updated) throw InterviewSessionError.notFound();
    this.prep.generateInBackground(sessionId);
    return this.toResponse(updated);
  }

  private async requireOwned(candidateId: string, sessionId: string): Promise<InterviewSessionRow> {
    const s = await this.sessions.findByIdAndCandidateId(sessionId, candidateId);
    if (!s) throw InterviewSessionError.notFound();
    return s;
  }

  private async toResponse(s: InterviewSessionRow): Promise<InterviewSessionResponse> {
    const company = await this.companies.findBySlug(s.company);
    return toSessionResponse(s, company?.name ?? null);
  }

  private async companyNames(slugs: string[]): Promise<Map<string, string>> {
    const rows = await this.companies.findAllBySlug(slugs);
    return new Map(rows.map((c) => [c.slug, c.name]));
  }
}
