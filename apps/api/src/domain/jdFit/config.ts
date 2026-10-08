import { LEVEL_EXPERIENCE_YEARS, type EngineeringLevel } from "../engineeringLevels.js";

export const FIT_PART_KEYS = ["skills", "domain", "role", "experience", "round_topics"] as const;
export type FitPartKey = (typeof FIT_PART_KEYS)[number];

export interface JdFitConfig {
  version: string;
  /** Per JD level; each row sums to 100. */
  weights: Record<EngineeringLevel, Record<FitPartKey, number>>;
  /** Weights used when the JD's level is unknown. */
  fallbackLevel: EngineeringLevel;
  /** Skill credit: used somewhere (project, role, GitHub, LeetCode) vs only in the resume skills list. */
  skillCredit: { used: number; listed: number };
  /** Domain/role credit by the best matching item's kind. */
  itemCredit: { experience: number; internship: number; project: number; repo: number };
  /** A GitHub language counts as used from this share of the user's code bytes. */
  githubLanguageMinPct: number;
  /** Solved problems for full coverage of a topic, by the hardest round that asks for it. */
  topicTargets: { easy: number; medium: number; hard: number };
  /** Total solved (best platform) for full coverage of a broad DSA ask ("Data structures", a DSA round with no specific topic). */
  generalDsaTargets: { easy: number; medium: number; hard: number };
  /** The broad-ask target never drops below the JD level's floor: an "easy" practice round for a fresher still expects real preparation. */
  generalDsaLevelFloor: Record<EngineeringLevel, number>;
  /** The same floor for one topic, so an easy aptitude test's "Arrays" is not saturated by a dozen problems while its "DSA" ask is not. */
  topicLevelFloor: Record<EngineeringLevel, number>;
  /** Experience below the JD's minimum falls linearly to 0 over this many years. */
  experienceRampYears: number;
  /**
   * Over-qualification is soft: above the JD's maximum the value falls linearly to this floor,
   * reaching it at double the maximum (or maximum + `overqualifiedSpanMinYears` for a sub-year maximum).
   * An open-ended range never decays.
   */
  overqualifiedFloor: number;
  overqualifiedSpanMinYears: number;
  /** Years asked by level, used when a JD has no `yoe` range. `null` max = open-ended. */
  levelBands: Readonly<Record<EngineeringLevel, readonly [number, number | null]>>;
  /** JD this many levels above the user: capped and labelled a stretch role. The same distance below: "below your level". */
  levelGap: number;
  stretchCap: number;
  /** A role below the user's level is a level mismatch in itself: the score is multiplied by this, one level below and two or more below. */
  belowLevelFactor: { one: number; twoOrMore: number };
  /** Evidence rows kept per part. */
  maxEvidence: number;
}

/** `jd-fit-v1`, approved 2026-10-06 (broad DSA, JD-text domain and generalist roles added the same day) (`docs/superpowers/specs/2026-10-06-jd-fit-score-design.md`). */
export const JD_FIT_CONFIG: JdFitConfig = {
  version: "jd-fit-v1",
  weights: {
    intern: { skills: 30, domain: 10, role: 15, experience: 10, round_topics: 35 },
    fresher: { skills: 30, domain: 10, role: 15, experience: 10, round_topics: 35 },
    sde1: { skills: 30, domain: 10, role: 15, experience: 20, round_topics: 25 },
    sde2: { skills: 30, domain: 15, role: 15, experience: 30, round_topics: 10 },
    sde3: { skills: 25, domain: 20, role: 15, experience: 35, round_topics: 5 },
    staff: { skills: 25, domain: 20, role: 15, experience: 35, round_topics: 5 },
    principal: { skills: 25, domain: 20, role: 15, experience: 35, round_topics: 5 },
    distinguished: { skills: 25, domain: 20, role: 15, experience: 35, round_topics: 5 },
  },
  fallbackLevel: "fresher",
  skillCredit: { used: 1, listed: 0.5 },
  itemCredit: { experience: 1, internship: 1, project: 0.6, repo: 0.6 },
  githubLanguageMinPct: 5,
  topicTargets: { easy: 8, medium: 20, hard: 40 },
  generalDsaTargets: { easy: 100, medium: 200, hard: 400 },
  generalDsaLevelFloor: { intern: 100, fresher: 150, sde1: 200, sde2: 200, sde3: 200, staff: 200, principal: 200, distinguished: 200 },
  topicLevelFloor: { intern: 10, fresher: 15, sde1: 20, sde2: 20, sde3: 20, staff: 20, principal: 20, distinguished: 20 },
  experienceRampYears: 2,
  overqualifiedFloor: 0.5,
  overqualifiedSpanMinYears: 1,
  levelBands: LEVEL_EXPERIENCE_YEARS,
  levelGap: 2,
  stretchCap: 40,
  belowLevelFactor: { one: 0.85, twoOrMore: 0.7 },
  maxEvidence: 3,
};
