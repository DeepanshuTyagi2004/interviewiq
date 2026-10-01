import type { InterviewSessionRow } from "../db/pg/schema.js";
import type { SessionStatus } from "../domain/enums.js";
import type { LiveKitTokenService } from "../integrations/livekit.js";
import { asDouble, asString, isObject } from "../lib/json.js";
import type { SessionOutcomeRepository } from "../repositories/mongo.js";
import type { InterviewSessionRepository } from "../repositories/pg.js";
import { InterviewSessionError } from "./interviewSessions.js";

/** Go-live / resume response. url + token are null when the session is not (yet) live. */
export interface LiveSessionResponse {
  livekitUrl: string | null;
  token: string | null;
  roomName: string | null;
  status: SessionStatus;
}

const TERMINAL: SessionStatus[] = ["COMPLETED", "ABORTED_TECHNICAL"];

/**
 * Go-live + resume for a booked session (live-interview runtime). Minting a token never mutates
 * state on resume — only PREP_READY → LIVE_IN_PROGRESS writes.
 */
export class LiveSessionService {
  constructor(
    private readonly sessions: InterviewSessionRepository,
    private readonly outcomes: SessionOutcomeRepository,
    private readonly liveKit: LiveKitTokenService,
  ) {}

  async startLive(candidateId: string, sessionId: string): Promise<LiveSessionResponse> {
    const s = await this.requireOwned(candidateId, sessionId);
    if (s.status === "LIVE_IN_PROGRESS") return this.connection(sessionId, candidateId, s.status); // resume
    if (s.status !== "PREP_READY") {
      throw InterviewSessionError.conflict("session_not_ready", "session must be PREP_READY to go live");
    }
    const updated = await this.sessions.transitionStatus(sessionId, "PREP_READY", "LIVE_IN_PROGRESS", {
      liveStartedAt: new Date(),
      livekitRoom: this.liveKit.roomName(sessionId),
    });
    // Lost a race with a concurrent go-live: that request already flipped it — just resume.
    const status = updated?.status ?? (await this.requireOwned(candidateId, sessionId)).status;
    if (status !== "LIVE_IN_PROGRESS") {
      throw InterviewSessionError.conflict("session_not_ready", "session must be PREP_READY to go live");
    }
    return this.connection(sessionId, candidateId, status);
  }

  async getLive(candidateId: string, sessionId: string): Promise<LiveSessionResponse> {
    const s = await this.requireOwned(candidateId, sessionId);
    if (s.status === "LIVE_IN_PROGRESS") return this.connection(sessionId, candidateId, s.status);
    return { livekitUrl: null, token: null, roomName: null, status: s.status };
  }

  /**
   * Called by the Python worker (internal, no owner scope) when an interview ends: stores the full
   * SessionOutcome in MongoDB, promotes a few scalars onto the Postgres row, and flips the session
   * to its terminal status. Delivery is at-least-once, so an already-terminal session is a no-op.
   */
  async recordOutcome(sessionId: string, outcome: unknown): Promise<void> {
    const s = await this.sessions.findById(sessionId);
    if (!s) throw InterviewSessionError.notFound();
    if (TERMINAL.includes(s.status)) return; // duplicate delivery

    const o = isObject(outcome) ? outcome : {};
    const endedReason = o.ended_reason === undefined || o.ended_reason === null ? null : asString(o.ended_reason, "");
    // Document first: if the status flip below fails, a retried delivery re-writes the same doc.
    await this.outcomes.save(sessionId, o);
    await this.sessions.update(sessionId, {
      endedReason,
      ...(o.live_score_final !== undefined && o.live_score_final !== null ? { liveScoreFinal: asDouble(o.live_score_final) } : {}),
      ...(o.duration_s !== undefined && o.duration_s !== null ? { durationS: Math.round(asDouble(o.duration_s)) } : {}),
      liveEndedAt: new Date(),
      status: endedReason === "aborted_technical" ? "ABORTED_TECHNICAL" : "COMPLETED",
    });
  }

  private async requireOwned(candidateId: string, sessionId: string): Promise<InterviewSessionRow> {
    const s = await this.sessions.findByIdAndCandidateId(sessionId, candidateId);
    if (!s) throw InterviewSessionError.notFound();
    return s;
  }

  private async connection(sessionId: string, candidateId: string, status: SessionStatus): Promise<LiveSessionResponse> {
    return {
      livekitUrl: this.liveKit.livekitUrl(),
      token: await this.liveKit.mintCandidateToken(sessionId, candidateId),
      roomName: this.liveKit.roomName(sessionId),
      status,
    };
  }
}
