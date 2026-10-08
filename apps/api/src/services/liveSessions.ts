import type { InterviewSessionRow } from "../db/pg/schema.js";
import type { SessionStatus } from "../domain/enums.js";
import type { LiveKitTokenService } from "../integrations/livekit.js";
import type { InterviewSessionRepository } from "../repositories/pg.js";
import type { BlueprintPrepService } from "./blueprintPrep.js";
import { InterviewSessionError } from "./interviewSessions.js";

/** Go-live / resume response. url + token are null when the session is not (yet) live. */
export interface LiveSessionResponse {
  livekitUrl: string | null;
  token: string | null;
  roomName: string | null;
  status: SessionStatus;
}

/**
 * Go-live + resume for a booked session (live-interview runtime). Minting a token never mutates
 * state on resume — only PREP_READY → LIVE_IN_PROGRESS writes. Going live is refused while the
 * live interviewer is unavailable (LIVE_INTERVIEWER_AVAILABLE=false), so no room is ever empty.
 */
export class LiveSessionService {
  constructor(
    private readonly sessions: InterviewSessionRepository,
    private readonly liveKit: LiveKitTokenService,
    private readonly prep: BlueprintPrepService,
    private readonly liveAvailable = false,
  ) {}

  async startLive(candidateId: string, sessionId: string): Promise<LiveSessionResponse> {
    const s = await this.requireOwned(candidateId, sessionId);
    if (s.status === "LIVE_IN_PROGRESS") return this.connection(sessionId, candidateId, s.status); // resume
    if (!this.liveAvailable) {
      throw InterviewSessionError.conflict("live_unavailable", "live interviews open soon; your interviewer is prepared");
    }
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
    // The problems of this blueprint are now "seen": later blueprints won't repeat them.
    if (updated) await this.prep.recordSeen(updated);
    return this.connection(sessionId, candidateId, status);
  }

  async getLive(candidateId: string, sessionId: string): Promise<LiveSessionResponse> {
    const s = await this.requireOwned(candidateId, sessionId);
    if (s.status === "LIVE_IN_PROGRESS") return this.connection(sessionId, candidateId, s.status);
    return { livekitUrl: null, token: null, roomName: null, status: s.status };
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
