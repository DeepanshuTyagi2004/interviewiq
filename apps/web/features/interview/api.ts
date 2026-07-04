import { apiFetch } from "@/lib/api-client/client";
import { INTERVIEW_ENDPOINTS } from "@/lib/constants/interview";
import type {
  CreateInterviewSessionRequest,
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
