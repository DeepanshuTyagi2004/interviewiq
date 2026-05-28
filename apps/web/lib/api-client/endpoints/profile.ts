import { apiFetch } from "../client";

export const profileApi = {
  me: () => apiFetch("/profile/me"),
  // TODO: add profile endpoints
};
