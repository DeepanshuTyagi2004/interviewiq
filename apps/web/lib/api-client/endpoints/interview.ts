import { apiFetch } from "../client";

export const interviewApi = {
  list: () => apiFetch("/interviews"),
  // TODO: add interview endpoints
};
