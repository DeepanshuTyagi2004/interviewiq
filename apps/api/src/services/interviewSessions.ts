import type { InterviewSessionRow } from "../db/pg/schema.js";
import { DEFAULT_ROUND_TYPE, optionalRoundType, type RoundType, type SessionStatus } from "../domain/enums.js";
import { ApiError } from "../lib/errors.js";
import { isObject } from "../lib/json.js";
import type {
  CompanyRepository,
  CompanyRoleConfigRepository,
  InterviewSessionRepository,
  JobDescriptionRepository,
  LoopRepository,
} from "../repositories/pg.js";
import { nodeStates, roundNodes } from "../domain/process.js";
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

/** Two interviews of one candidate may not start within this many minutes of each other. */
export const SLOT_MINUTES = 60;

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
  loopId: string | null;
  nodeId: string | null;
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
    loopId: s.loopId,
    nodeId: s.nodeId,
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
  /** Book a round of a confirmed loop: both set together, or neither. */
  loopId: string | null;
  nodeId: string | null;
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
  const loopId = b.loopId;
  if (loopId !== undefined && loopId !== null && (typeof loopId !== "string" || !UUID_RE.test(loopId))) {
    throw InterviewSessionError.badRequest("session_bad_request", "loopId must be a UUID");
  }
  const nodeId = b.nodeId;
  if (nodeId !== undefined && nodeId !== null && (typeof nodeId !== "string" || nodeId.length === 0 || nodeId.length > 64)) {
    throw InterviewSessionError.badRequest("session_bad_request", "nodeId must be a non-empty string");
  }
  if ((loopId ?? null) === null !== ((nodeId ?? null) === null)) {
    throw InterviewSessionError.badRequest("session_bad_request", "loopId and nodeId must be sent together");
  }
  return {
    jobDescriptionId: typeof jd === "string" ? jd.toLowerCase() : null,
    roundType: optionalRoundType(b.roundType),
    scheduledAt,
    timezone: typeof b.timezone === "string" ? b.timezone : null,
    loopId: typeof loopId === "string" ? loopId.toLowerCase() : null,
    nodeId: typeof nodeId === "string" ? nodeId : null,
  };
}

function slotTaken() {
  return InterviewSessionError.conflict("session_slot_taken", "you already have an interview at that time");
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
    private readonly loops?: LoopRepository,
  ) {}

  async createSession(candidateId: string, req: CreateSessionRequest): Promise<InterviewSessionResponse> {
    // A round of a confirmed loop: the loop fixes the JD, the node fixes the round, and the node
    // must be unlocked (every round feeding into it completed).
    let loopRound: { jdId: string; type: RoundType } | null = null;
    if (req.loopId && req.nodeId) {
      const loop = await this.loops?.findOwned(req.loopId, candidateId);
      if (!loop) throw InterviewSessionError.notFound();
      if (loop.status !== "active") throw InterviewSessionError.conflict("loop_not_active", "this loop is not active");
      const node = roundNodes(loop.graph).find((n) => n.id === req.nodeId);
      if (!node) throw InterviewSessionError.badRequest("session_node_not_found", "that round is not part of this loop");
      const state = nodeStates(loop.graph, await this.sessions.findAllByLoopIds([loop.id])).get(node.id);
      if (state === "locked") throw InterviewSessionError.conflict("round_locked", "complete the earlier rounds first");
      if (state === "booked") throw InterviewSessionError.conflict("round_already_booked", "this round is already booked");
      if (state === "completed") throw InterviewSessionError.conflict("round_already_completed", "this round is already completed");
      loopRound = { jdId: loop.jdId, type: node.type };
    }
    const jobDescriptionId = loopRound?.jdId ?? req.jobDescriptionId;
    if (!jobDescriptionId) {
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

    const jd = await this.jds.findById(jobDescriptionId);
    if (!jd || !jd.active) throw InterviewSessionError.badRequest("session_jd_not_found", "job description not found");
    const manual = await this.enrichment?.briefForJd(jd.id);
    const roundType = loopRound?.type ?? req.roundType ?? manual?.final_experience.rounds.find((r) => r.kind !== "info")?.type ?? DEFAULT_ROUND_TYPE;

    // The JD must map to a configured, enabled company/role/level — the key the brief + question
    // bank are built on.
    const config = await this.roleConfigs.findByCompanyAndRoleAndLevel(jd.company, jd.role, jd.level);
    if (!config) {
      throw InterviewSessionError.badRequest("session_role_not_configured", "this job description is not a configured interview target");
    }
    if (!config.enabled) {
      throw InterviewSessionError.badRequest("session_role_disabled", "interviews for this role are not currently available");
    }

    const session = await this.sessions.insertIfSlotFree({
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
      loopId: req.loopId,
      nodeId: req.nodeId,
    }, SLOT_MINUTES);
    if (!session) throw slotTaken();
    return this.toResponse(session);
  }

  /** Move a not-yet-started interview to another slot. */
  async reschedule(candidateId: string, sessionId: string, scheduledAt: Date, timezone: string): Promise<InterviewSessionResponse> {
    const s = await this.requireOwned(candidateId, sessionId);
    if (!["SCHEDULED", "PREP_READY", "PREP_FAILED"].includes(s.status)) {
      throw InterviewSessionError.conflict("session_not_reschedulable", "this interview can no longer be moved");
    }
    if (scheduledAt.getTime() < Date.now()) throw InterviewSessionError.badRequest("session_slot_in_past", "the selected slot is in the past");
    if (timezone.trim() === "") throw InterviewSessionError.badRequest("session_timezone_required", "timezone is required");
    const updated = await this.sessions.rescheduleIfSlotFree(sessionId, candidateId, scheduledAt, timezone.trim(), SLOT_MINUTES);
    if (!updated) throw slotTaken();
    return this.toResponse(updated);
  }

  /** Cancel a not-yet-started interview; its slot and loop round become free again. */
  async cancel(candidateId: string, sessionId: string): Promise<InterviewSessionResponse> {
    const s = await this.requireOwned(candidateId, sessionId);
    if (!["SCHEDULED", "PREP_READY", "PREP_FAILED"].includes(s.status)) {
      throw InterviewSessionError.conflict("session_not_cancellable", "this interview can no longer be cancelled");
    }
    const updated = await this.sessions.transitionStatus(sessionId, s.status, "CANCELLED");
    if (!updated) throw InterviewSessionError.conflict("session_not_cancellable", "this interview can no longer be cancelled");
    return this.toResponse(updated);
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
