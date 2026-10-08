import type { EngineeringLevel } from "../engineeringLevels.js";
import type { FitPartKey } from "./config.js";

export type FitPartStatus = "scored" | "missing" | "dropped";
export type LevelGap = "none" | "stretch" | "below" | "unknown";
export type FitSource = "resume" | "github" | "leetcode" | "codeforces" | "tuf";
export type FitItemKind = "experience" | "internship" | "project" | "repo";

/** Why a part scored what it did: which item (or platform topic) matched which tag, through which word. */
export interface FitEvidence {
  source: FitSource;
  item: string;
  matched: string;
  tag: string;
}

export interface FitPart {
  key: FitPartKey;
  /** The configured weight; dropped parts are left out of the total and the rest rescale. */
  weight: number;
  /** 0–1. */
  value: number;
  status: FitPartStatus;
  evidence: FitEvidence[];
  /** What the JD asks for that the profile doesn't show (skills, round topics). */
  uncovered: string[];
  /** Set when `missing`: what to connect or add. */
  hint: string | null;
  /** Set when `dropped`: what the JD lacks. */
  reason: string | null;
}

export interface FitResult {
  jdId: string;
  /** 0–100, or null when every part is dropped. */
  score: number | null;
  levelGap: LevelGap;
  cap: number | null;
  /** Multiplier applied for a role below the user's level (0.85 one level below, 0.7 two or more); null otherwise. */
  levelFactor: number | null;
  userLevel: EngineeringLevel | null;
  jdLevel: EngineeringLevel | null;
  configVersion: string;
  parts: FitPart[];
}

export interface TagHit {
  tag: string;
  matched: string;
}

/** One tagged thing the user built or worked on. Text is lowercased; entries are joined with " | " so phrases never span two entries. */
export interface FitItem {
  source: "resume" | "github";
  kind: FitItemKind;
  title: string;
  text: string;
  /** Structured tech list (resume project tech, a repo's primary language), lowercased. */
  tech: string[];
  domains: TagHit[];
  roles: TagHit[];
}

export interface TopicCount {
  count: number;
  source: Exclude<FitSource, "resume" | "github">;
  /** The platform's own topic name. */
  name: string;
}

/** Everything fit needs from one user, built once per request. */
export interface FitProfile {
  level: EngineeringLevel | null;
  items: FitItem[];
  /** Resume skills list, lowercased. */
  listedSkills: string[];
  /** GitHub languages at or above the configured byte share, lowercased. */
  githubLanguages: string[];
  preferredLanguage: string | null;
  /** Best single platform per canonical DSA topic. */
  topics: Record<string, TopicCount>;
  /** A LeetCode, Codeforces or TUF fragment exists (even with nothing solved). */
  hasTopicSource: boolean;
  /** Most problems solved on one of those platforms (broad DSA asks), or null when none reports a total. */
  totalSolved: TopicCount | null;
  fullTimeMonths: number;
}

export interface FitRound {
  topics: string[];
  difficulty: string | null;
  /** Round type from the brief ("dsa", "system-design", …). */
  type: string | null;
}

export interface FitJd {
  id: string;
  level: EngineeringLevel | null;
  /** Company `sector`. */
  sector: string | null;
  specialization: string | null;
  /** Title and description, lowercased: the domain source when the company's sector is generic. */
  text: string;
  techStack: string[];
  yoeMin: number | null;
  yoeMax: number | null;
  rounds: FitRound[];
}
