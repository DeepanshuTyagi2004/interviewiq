import type { EngineeringLevel } from "./types";
export { ENGINEERING_LEVEL_OPTIONS as LEVEL_OPTIONS, levelLabel } from "@/lib/constants/engineering-levels";

export const SCORE_KEYS = {
  all: ["profile-scoring"] as const,
  me: ["profile-scoring", "me"] as const,
  leaderboard: (level: EngineeringLevel) => ["profile-scoring", "leaderboard", level] as const,
  diagnostics: (userId?: string) => ["profile-scoring", "diagnostics", userId ?? "overview"] as const,
};

export const percent = (value: number) => `${Math.round(value)}%`;
export const scoreValue = (value: number | null | undefined) => value == null ? "Unknown" : `${Math.round(value * 10) / 10} / 100`;
export const BETA_NOTE = "Provisional beta · Not a validated hiring assessment. Separate from interview scores.";
