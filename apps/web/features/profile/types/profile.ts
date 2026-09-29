/**
 * Mirrors GET /api/v1/profile/me → ProfileResponse (spec §6) and the GitHub
 * fragment shape (spec §4). HARD RULE: no score/rank/grade/comparative field
 * appears anywhere in this contract or its UI.
 */

import { PROFILE_SYNC_STATUS } from "@/lib/constants/profile";

export type SourceKind = "GITHUB" | "RESUME" | "LEETCODE" | "LINKEDIN" | "X";

/** Background-collection lifecycle for sources that sync asynchronously (currently LeetCode). */
export type SyncStatus = (typeof PROFILE_SYNC_STATUS)[keyof typeof PROFILE_SYNC_STATUS];

export interface ProfileUser {
  name: string | null;
  headline?: string | null;
}

export interface ProfileSource {
  source: SourceKind;
  connected: boolean;
  /** ISO timestamp; present only when connected. */
  lastRefreshedAt?: string;
  /** Background-sync state; present only for async sources (LeetCode). Omitted otherwise. */
  status?: SyncStatus;
}

export interface NotableItem {
  text: string;
  source: SourceKind;
}

export interface SkillItem {
  skill: string;
  /** Cross-source attribution, e.g. "GitHub 48%". Never a score. Not rendered in the UI. */
  evidence: string;
  /** Originating source — drives the source icon shown on each skill tag. */
  source: SourceKind;
}

export interface GithubLanguage {
  name: string;
  pct: number;
  bytes: number;
}

export interface GithubTopRepo {
  name: string;
  stars: number;
  /** Backend serializes empty string when absent, never null. */
  primaryLang: string;
}

export interface GithubContributions {
  lastYear: number;
  /** 52 weeks x 7 days of counts. */
  weeks: number[][];
}

export interface GithubFragment {
  login: string;
  /** Backend serializes empty string when absent, never null. */
  name: string;
  avatarUrl: string;
  joinedYear: number;
  publicRepos: number;
  contributions: GithubContributions;
  languages: GithubLanguage[];
  externalPRs: number;
  topRepos: GithubTopRepo[];
}

export interface LeetCodeContest {
  attended: number;
  /** LeetCode's own contest rating — a factual source stat, never an InterviewIQ score. */
  rating: number;
  globalRanking: number;
  totalParticipants: number;
  topPercent: number;
}

export interface LeetCodeRecentActivity {
  /** Accepted submissions in the last 30 days. */
  last30Days: number;
  /** Most-frequent language across recent accepted submissions; null when no recent activity. */
  preferredLanguage: string | null;
}

/**
 * Normalized LeetCode fragment produced by the backend collector. `solved` + `byTopic` drive the
 * difficulty/topic charts; the rest is descriptive context for the synthesis bands. Counts/stats
 * only — never a score, rank, or grade. `streak` is always null (not exposed by public profiles).
 */
export interface LeetCodeFragment {
  username?: string;
  country?: string;
  solved: { easy: number; medium: number; hard: number; total?: number };
  byTopic: { topic: string; count: number }[];
  contest?: LeetCodeContest | null;
  recentActivity?: LeetCodeRecentActivity;
  streak?: null;
  /** True when some optional queries failed and the fragment is incomplete. */
  partial?: boolean;
}

export interface ProfileFragments {
  github?: GithubFragment;
  leetcode?: LeetCodeFragment;
}

export interface ProvenanceItem {
  source: SourceKind;
  fragmentHash: string;
  fetchedAt: string;
}

export interface ProfileResponse {
  user: ProfileUser;
  sources: ProfileSource[];
  notable: NotableItem[];
  mostUsedSkills: SkillItem[];
  atAGlance: string[];
  fragments: ProfileFragments;
  provenance: ProvenanceItem[];
}
