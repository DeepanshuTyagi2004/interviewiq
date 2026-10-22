import { z } from "zod";
import type { InterviewSessionRow, LiveSummary } from "../db/pg/schema.js";
import type { SessionStatus } from "../domain/enums.js";
import { sessionRoundMinutes } from "../domain/liveRound.js";
import type { AiServiceClient } from "../integrations/aiService/client.js";
import type { AgentRooms, LiveKitTokenService } from "../integrations/livekit.js";
import { errorMessage } from "../lib/errors.js";
import type { BackgroundTasks } from "../lib/background.js";
import type { Logger } from "../lib/logger.js";
import type { CompanyRepository } from "../repositories/pg.js";
import type { InterviewSessionRepository } from "../repositories/pg.js";
import type { BlueprintPrepService } from "./blueprintPrep.js";
import { InterviewSessionError } from "./interviewSessions.js";
import { LiveAvailability } from "./liveAvailability.js";
import type { InterviewAccess } from "./interviewAccess.js";
import type { RoundEvaluationService } from "./roundEvaluation.js";

const END_REASONS = ["completed", "ended_by_interviewer", "candidate_ended", "technical"] as const;
export type LiveEndReason = (typeof END_REASONS)[number];

/** The interviewer worker's end request (spec §8.2). */
export const LiveEndBody = z.object({
  reason: z.enum(END_REASONS),
  live_summary: z
    .object({
      tab_changes: z.number().int().min(0).default(0),
      screen_changes_weighted: z.number().min(0).default(0),
      full_violations: z.number().int().min(0).default(0),
      conduct_incidents: z.number().int().min(0).default(0),
      ended_at: z.string().max(64).optional(),
      interviewer_note: z.string().max(2000).optional(),
    })
    .default({ tab_changes: 0, screen_changes_weighted: 0, full_violations: 0, conduct_incidents: 0 }),
});

/** No re-dispatch until the interviewer had this long to join after go-live (or after the last dispatch). */
export const REDISPATCH_AFTER_MS = 30_000;

/** Go-live / resume response. url + token are null when the session is not (yet) live. */
export interface LiveSessionResponse {
  livekitUrl: string | null;
  token: string | null;
  roomName: string | null;
  status: SessionStatus;
}

/** Whether the live interviewer is up: `waking` while its host is asleep or its worker has not registered yet. */
export interface LiveReadinessResponse {
  interviewer: "ready" | "waking";
}

/** What a warm-up tells the page: an interviewer is in the room or on its way (`warming`), or nothing was started. */
export interface WarmResponse {
  warming: boolean;
}

type DispatchOutcome = "dispatched" | "already_there" | "failed";
/** Who asked for the interviewer: named in the log so a line says which step it belongs to. */
type DispatchSource = "warm" | "go-live";

/**
 * Go-live + resume for a booked session (live-interview runtime). Minting a token never mutates
 * state on resume — only PREP_READY → LIVE_IN_PROGRESS writes. Going live is refused while the
 * live interviewer is unavailable (LIVE_INTERVIEWER_AVAILABLE=false), so no room is ever empty.
 */
export class LiveSessionService {
  private readonly lastDispatch = new Map<string, number>();
  private readonly dispatching = new Map<string, Promise<DispatchOutcome>>();

  constructor(
    private readonly sessions: InterviewSessionRepository,
    private readonly liveKit: LiveKitTokenService,
    private readonly prep: BlueprintPrepService,
    private readonly live: LiveAvailability = new LiveAvailability(false),
    private readonly rooms: AgentRooms | null = null,
    private readonly companies: CompanyRepository | null = null,
    private readonly log: Logger | null = null,
    private readonly evaluation: RoundEvaluationService | null = null,
    private readonly background: BackgroundTasks | null = null,
    private readonly access: InterviewAccess,
    private readonly aiService: Pick<AiServiceClient, "health"> | null = null,
  ) {}

  /**
   * Whether the voice worker is alive; anything short of that, or no answer in time, is `waking` (never an error). The ai-service
   * answers from the worker's own heartbeat (asking also wakes the ai-service if it sleeps). When it answers but the worker is down
   * (LiveKit Cloud scaled it to zero), a dispatch for this round is the only thing that starts it, so a round that could go live gets
   * one (shared with go-live, never a second interviewer) and the page keeps Start disabled until the heartbeat shows the worker up.
   */
  async readiness(candidateId: string, sessionId?: string): Promise<LiveReadinessResponse> {
    const h = await this.aiService?.health();
    if (!h) return { interviewer: "waking" };
    if (h.interviewer === "ready") return { interviewer: "ready" };
    if (sessionId && this.rooms) {
      try {
        await this.access.assertCanInterview(candidateId);
        const s = await this.requireOwned(candidateId, sessionId);
        const eligible = s.status === "LIVE_IN_PROGRESS" || (s.status === "PREP_READY" && this.live.isAvailableFor(candidateId));
        if (eligible) await this.dispatchUnlessPresent(sessionId, "warm");
      } catch (err) {
        this.log?.warn(`interviewer wake-up failed for session ${sessionId}: ${errorMessage(err)}`);
      }
    }
    return { interviewer: "waking" };
  }

  async startLive(candidateId: string, sessionId: string): Promise<LiveSessionResponse> {
    await this.access.assertCanInterview(candidateId);
    const s = await this.requireOwned(candidateId, sessionId);
    if (s.status === "LIVE_IN_PROGRESS") {
      await this.ensureAgent(s); // resume
      return this.connection(sessionId, candidateId, s.status);
    }
    if (!this.live.isAvailableFor(candidateId)) {
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
    if (updated) await this.dispatchUnlessPresent(sessionId, "go-live");
    return this.connection(sessionId, candidateId, status);
  }

  async getLive(candidateId: string, sessionId: string): Promise<LiveSessionResponse> {
    const s = await this.requireOwned(candidateId, sessionId);
    if (s.status === "LIVE_IN_PROGRESS") {
      await this.ensureAgent(s);
      return this.connection(sessionId, candidateId, s.status);
    }
    return { livekitUrl: null, token: null, roomName: null, status: s.status };
  }

  /**
   * Get the interviewer into the room while the candidate reads the instructions (spec 2026-10-11). Owner only, and never an
   * error for a round that is not eligible. Changes nothing but the dispatch: no status, no seen problems, no clock.
   */
  async warm(candidateId: string, sessionId: string): Promise<WarmResponse> {
    await this.access.assertCanInterview(candidateId);
    const s = await this.requireOwned(candidateId, sessionId);
    const eligible = s.status === "LIVE_IN_PROGRESS" || (s.status === "PREP_READY" && this.live.isAvailableFor(candidateId));
    if (!eligible) return { warming: false };
    return { warming: (await this.dispatchUnlessPresent(sessionId, "warm")) !== "failed" };
  }

  /** The round and a minimal profile for the interviewer worker; only while the session is live. */
  async context(sessionId: string) {
    const s = await this.sessions.findById(sessionId);
    if (!s) throw InterviewSessionError.notFound();
    // A ready round answers too: the interviewer loads it while the candidate reads the instructions.
    if (s.status !== "LIVE_IN_PROGRESS" && s.status !== "PREP_READY") {
      throw InterviewSessionError.conflict("session_not_live", "the session is not live");
    }
    const [{ firstName, profile }, company] = await Promise.all([this.prep.liveContext(s), this.companies?.findBySlug(s.company) ?? null]);
    return {
      session_id: s.id,
      candidate_id: s.candidateId,
      first_name: firstName,
      status: s.status,
      round: {
        company: s.company,
        company_name: company?.name ?? null,
        role: s.role,
        level: s.level,
        round_type: s.roundType,
        duration_mins: s.prepBriefing?.duration_mins ?? sessionRoundMinutes(s),
      },
      profile,
    };
  }

  /** The interviewer worker ends the round (idempotent). */
  async endFromInterviewer(sessionId: string, reason: LiveEndReason, summary: LiveSummary) {
    const s = await this.sessions.findById(sessionId);
    if (!s) throw InterviewSessionError.notFound();
    if ((s.status === "COMPLETED" || s.status === "ABORTED_TECHNICAL") && s.liveEndedAt && s.liveSummary == null) {
      // The candidate's End fallback closed the round before the interviewer's own report arrived. Its reason and
      // summary are the record (a misconduct ending must not be laundered into "the candidate ended it").
      const to: SessionStatus = reason === "technical" ? "ABORTED_TECHNICAL" : "COMPLETED";
      const fixed = await this.sessions.completeLiveEnd(s.id, { status: to, endedReason: reason, liveSummary: summary });
      // The round turned out to be a technical end after the evaluation was queued: it is not scored.
      if (fixed && to === "ABORTED_TECHNICAL") await this.sessions.applyEvaluation(s.id, { evalStatus: "unscorable", outcome: "unscorable" });
      if (fixed) return { status: fixed.status, ended_reason: fixed.endedReason, already_ended: true };
    }
    const r = await this.end(s, reason, summary);
    return { status: r.status, ended_reason: r.endedReason, already_ended: r.alreadyEnded };
  }

  /** The candidate ends the round: the fallback when the interviewer doesn't answer End. */
  async endFromCandidate(candidateId: string, sessionId: string) {
    const r = await this.end(await this.requireOwned(candidateId, sessionId), "candidate_ended", null);
    return { status: r.status, endReason: r.endedReason, alreadyEnded: r.alreadyEnded };
  }

  private async end(s: InterviewSessionRow, reason: LiveEndReason, summary: LiveSummary | null) {
    if (s.status === "COMPLETED" || s.status === "ABORTED_TECHNICAL") {
      return { status: s.status, endedReason: s.endedReason, alreadyEnded: true };
    }
    if (s.status !== "LIVE_IN_PROGRESS") throw InterviewSessionError.conflict("session_not_live", "the session is not live");
    const now = new Date();
    const to: SessionStatus = reason === "technical" ? "ABORTED_TECHNICAL" : "COMPLETED";
    const updated = await this.sessions.transitionStatus(s.id, "LIVE_IN_PROGRESS", to, {
      liveEndedAt: now,
      endedReason: reason,
      liveSummary: summary,
      durationS: s.liveStartedAt ? Math.round((now.getTime() - s.liveStartedAt.getTime()) / 1000) : null,
      // A completed round queues its evaluation in the same transition; a technical end is never scored (no run, free retake).
      ...(to === "COMPLETED" ? { evalStatus: "pending" } : { evalStatus: "unscorable", outcome: "unscorable" as const }),
    });
    if (!updated) {
      // Lost a race with another ender: report what won.
      const latest = (await this.sessions.findById(s.id))!;
      return { status: latest.status, endedReason: latest.endedReason, alreadyEnded: true };
    }
    if (to === "COMPLETED" && this.evaluation) {
      const evaluation = this.evaluation;
      this.background?.run(`evaluation-start-${updated.id}`, () => evaluation.start(updated, "completion"));
    }
    return { status: to, endedReason: reason, alreadyEnded: false };
  }

  /** Whether LiveKit took the dispatch. A refused one is not remembered, so the next resume or warm-up tries again. */
  private async dispatch(sessionId: string): Promise<boolean> {
    if (!this.rooms) return false;
    try {
      await this.rooms.dispatchAgent(sessionId);
      this.lastDispatch.set(sessionId, Date.now());
      return true;
    } catch (err) {
      // The candidate still gets a token and enters; the next resume checks the room and dispatches again.
      this.log?.warn(`interviewer dispatch failed for session ${sessionId}: ${errorMessage(err)}`);
      return false;
    }
  }

  /** Concurrent callers for one session share one attempt (a page that mounts twice must not start two interviewers). */
  private dispatchUnlessPresent(sessionId: string, source: DispatchSource): Promise<DispatchOutcome> {
    const running = this.dispatching.get(sessionId);
    if (running) return running;
    const attempt = this.dispatchIfAbsent(sessionId, source).finally(() => this.dispatching.delete(sessionId));
    this.dispatching.set(sessionId, attempt);
    return attempt;
  }

  /**
   * Dispatch the interviewer unless one is in the room, is already on its way, or was dispatched in the last 30 s. A failed
   * presence check does not stop the dispatch: a second interviewer leaves by itself (the worker's guard), a missing one cannot.
   */
  private async dispatchIfAbsent(sessionId: string, source: DispatchSource): Promise<DispatchOutcome> {
    if (!this.rooms) return "failed";
    const { outcome, why } = await this.decide(sessionId);
    const said = outcome === "already_there" ? "skipped" : outcome;
    this.log?.info(`interviewer for session ${sessionId} (${source}): ${said}, ${why}`);
    return outcome;
  }

  private async decide(sessionId: string): Promise<{ outcome: DispatchOutcome; why: string }> {
    const last = this.lastDispatch.get(sessionId);
    if (last !== undefined && Date.now() - last < REDISPATCH_AFTER_MS) return { outcome: "already_there", why: "dispatched under 30 s ago" };
    // Both questions at once: this runs before the candidate gets a token. A failed answer is not a "no" that hides a "yes" from the other.
    const [inRoom, pending] = await Promise.allSettled([this.rooms!.hasAgent(sessionId), this.rooms!.hasDispatch(sessionId)]);
    const failed = [inRoom, pending].filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed.length > 0) {
      this.log?.warn(`interviewer presence check failed for session ${sessionId}: ${failed.map((r) => errorMessage(r.reason)).join("; ")}`);
    }
    if (inRoom.status === "fulfilled" && inRoom.value) return { outcome: "already_there", why: "interviewer in the room" };
    if (pending.status === "fulfilled" && pending.value) return { outcome: "already_there", why: "interviewer dispatch pending" };
    return (await this.dispatch(sessionId))
      ? { outcome: "dispatched", why: "none in the room" }
      : { outcome: "failed", why: "LiveKit refused the dispatch" };
  }

  /** On resume: dispatch again when the room has no interviewer (the worker crashed), never twice in 30 s. */
  private async ensureAgent(s: InterviewSessionRow): Promise<void> {
    if (!this.rooms) return;
    const since = Math.max(s.liveStartedAt?.getTime() ?? 0, this.lastDispatch.get(s.id) ?? 0);
    if (Date.now() - since < REDISPATCH_AFTER_MS) return;
    try {
      if (!(await this.rooms.hasAgent(s.id))) await this.dispatch(s.id);
    } catch (err) {
      this.log?.warn(`interviewer presence check failed for session ${s.id}: ${errorMessage(err)}`);
    }
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
