import { apiFetch } from "../client";
import { JOBS_ENDPOINTS } from "@/lib/constants/jobs";

export const jobsApi = {
  list: () => apiFetch(JOBS_ENDPOINTS.list),
  // TODO: add jobs endpoints
};
