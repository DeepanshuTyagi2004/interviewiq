import { apiFetch } from "../client";

export const jobsApi = {
  list: () => apiFetch("/jobs"),
  // TODO: add jobs endpoints
};
