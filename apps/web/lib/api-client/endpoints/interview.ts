import { apiFetch } from "../client";
import { INTERVIEW_ENDPOINTS } from "@/lib/constants/interview";

export const interviewApi = {
  list: () => apiFetch(INTERVIEW_ENDPOINTS.list),
  // TODO: add interview endpoints
};
