import { apiFetch } from "@/lib/api-client/client";
import type { EngineeringLevel, ProfileDiagnosticsResponse, ProfileLeaderboardResponse, ProfileScoreResponse, ProfileScoringSettings } from "./types";

const SCORE_PATH = "/api/v1/users/me/profile-score";
export const getProfileScore = () => apiFetch<ProfileScoreResponse>(SCORE_PATH);
export const recalculateProfileScore = () => apiFetch<ProfileScoreResponse>(SCORE_PATH, { method: "POST" });
export const updateScoringSettings = (settings: Partial<ProfileScoringSettings>) =>
  apiFetch<ProfileScoreResponse>(`${SCORE_PATH}/settings`, { method: "PATCH", json: settings });
export const getProfileLeaderboard = (level: EngineeringLevel) =>
  apiFetch<ProfileLeaderboardResponse>(`/api/v1/profile-leaderboard?${new URLSearchParams({ level, limit: "25" })}`);
export const getProfileDiagnostics = (userId?: string) =>
  apiFetch<ProfileDiagnosticsResponse>(`/api/v1/intelligence/diagnostics${userId ? `?${new URLSearchParams({ userId })}` : ""}`);
