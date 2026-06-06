/**
 * Mirrors GET /api/v1/profile/me → ProfileResponse (spec §6) and the GitHub
 * fragment shape (spec §4). HARD RULE: no score/rank/grade/comparative field
 * appears anywhere in this contract or its UI.
 */

export type SourceKind = "GITHUB" | "RESUME" | "LEETCODE" | "LINKEDIN" | "X";

export interface ProfileUser {
  name: string | null;
  headline?: string | null;
}

export interface ProfileSource {
  source: SourceKind;
  connected: boolean;
  /** ISO timestamp; present only when connected. */
  lastRefreshedAt?: string;
}

export interface NotableItem {
  text: string;
  source: SourceKind;
}

export interface SkillItem {
  skill: string;
  /** Cross-source attribution, e.g. "GitHub 48%". Never a score. */
  evidence: string;
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

/**
 * LeetCode fragment is NOT produced by this slice (no collector yet). The
 * shape is declared so the data-driven charts compile; `fragments.leetcode`
 * is undefined until the LeetCode collector ships.
 */
export interface LeetCodeFragment {
  solved: { easy: number; medium: number; hard: number };
  byTopic: { topic: string; count: number }[];
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
