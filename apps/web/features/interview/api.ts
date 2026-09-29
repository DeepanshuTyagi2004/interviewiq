import { apiFetch } from "@/lib/api-client/client";
import { INTERVIEW_ENDPOINTS } from "@/lib/constants/interview";
import type {
  CreateInterviewSessionRequest,
  GoLiveResponse,
  InterviewSession,
  InterviewSessionListResponse,
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

/** POST /api/v1/interviews/sessions/{id}/regenerate — re-queue prep (retry after PREP_FAILED). */
export function regenerateSession(id: string): Promise<InterviewSession> {
  return apiFetch<InterviewSession>(INTERVIEW_ENDPOINTS.regenerate(id), { method: "POST" });
}

/** POST /api/v1/interviews/sessions/{id}/live — start (or resume) the live interview; mints a LiveKit join token. */
export function goLive(id: string): Promise<GoLiveResponse> {
  return apiFetch<GoLiveResponse>(INTERVIEW_ENDPOINTS.live(id), { method: "POST" });
}

/** GET /api/v1/interviews/sessions/{id}/live — current live state (fresh token if LIVE_IN_PROGRESS). */
export function getLive(id: string): Promise<GoLiveResponse> {
  return apiFetch<GoLiveResponse>(INTERVIEW_ENDPOINTS.live(id));
}
