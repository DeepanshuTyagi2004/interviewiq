import { apiFetch } from "@/lib/api-client/client";
import { INTERVIEW_ENDPOINTS } from "@/lib/constants/interview";
import type {
  CandidateLiveEndResult,
  CreateInterviewSessionRequest,
  GoLiveResponse,
  InterviewSession,
  InterviewSessionListResponse,
  LiveReadinessResponse,
  WarmLiveResponse,
} from "./types";

/** GET /api/v1/interviews/sessions — the candidate's sessions (newest first). */
export function listMySessions(): Promise<InterviewSessionListResponse> {
  return apiFetch<InterviewSessionListResponse>(INTERVIEW_ENDPOINTS.sessions);
}

/** GET /api/v1/interviews/sessions/{id} — one session's status. */
export function getSession(id: string): Promise<InterviewSession> {
  return apiFetch<InterviewSession>(INTERVIEW_ENDPOINTS.session(id));
}

/** POST /api/v1/interviews/sessions — book a session for a JD + round + slot. */
export function createSession(body: CreateInterviewSessionRequest): Promise<InterviewSession> {
  return apiFetch<InterviewSession>(INTERVIEW_ENDPOINTS.sessions, { method: "POST", json: body });
}

/** POST /api/v1/interviews/sessions/{id}/prep/retry — retry blueprint prep after PREP_FAILED (429 when retried too often). */
export function retryPrep(id: string): Promise<InterviewSession> {
  return apiFetch<InterviewSession>(INTERVIEW_ENDPOINTS.retryPrep(id), { method: "POST" });
}

/** POST /api/v1/interviews/sessions/{id}/live — start (or resume) the live interview; mints a LiveKit join token. */
export function goLive(id: string): Promise<GoLiveResponse> {
  return apiFetch<GoLiveResponse>(INTERVIEW_ENDPOINTS.live(id), { method: "POST" });
}

/** GET /api/v1/interviews/sessions/{id}/live — current live state (fresh token if LIVE_IN_PROGRESS). */
export function getLive(id: string): Promise<GoLiveResponse> {
  return apiFetch<GoLiveResponse>(INTERVIEW_ENDPOINTS.live(id));
}

/** GET /api/v1/interviews/live/readiness — whether the voice worker is alive ("waking" while a sleeping service starts). With a session id
 * a down worker is also started for that round (LiveKit starts a worker that scaled to zero when the interviewer is dispatched). */
export function getLiveReadiness(sessionId?: string): Promise<LiveReadinessResponse> {
  const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''
  return apiFetch<LiveReadinessResponse>(`${INTERVIEW_ENDPOINTS.liveReadiness}${query}`)
}

/** POST /api/v1/interviews/sessions/{id}/live/warm — get the interviewer into the room while the candidate reads the instructions (best effort). */
export function warmLive(id: string): Promise<WarmLiveResponse> {
  return apiFetch<WarmLiveResponse>(INTERVIEW_ENDPOINTS.liveWarm(id), { method: "POST" });
}

/** POST /api/v1/interviews/sessions/{id}/live/end — end the live round when the interviewer didn't answer End (idempotent). */
export function endLive(id: string): Promise<CandidateLiveEndResult> {
  return apiFetch<CandidateLiveEndResult>(INTERVIEW_ENDPOINTS.liveEnd(id), { method: "POST" });
}

/** POST /api/v1/interviews/sessions/{id}/reschedule — move a not-yet-started interview (409 session_slot_taken on a clash). */
export function rescheduleSession(id: string, body: { scheduledAt: string; timezone: string }): Promise<InterviewSession> {
  return apiFetch<InterviewSession>(INTERVIEW_ENDPOINTS.reschedule(id), { method: "POST", json: body });
}

/** POST /api/v1/interviews/sessions/{id}/cancel — cancel a not-yet-started interview. */
export function cancelSession(id: string): Promise<InterviewSession> {
  return apiFetch<InterviewSession>(INTERVIEW_ENDPOINTS.cancel(id), { method: "POST" });
}
