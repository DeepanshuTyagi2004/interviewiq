import { ENGINEERING_LEVELS, type ScoringConfig } from "./types.js";
import { deepFreeze } from "./sanitization.js";

export const COMPONENT_LABELS: Record<string, string> = {
  problem_solving: "DSA & problem solving",
  competitive_programming: "Competitive programming",
  internship_experience: "Internship experience",
  projects: "Projects",
  professional_experience: "Professional experience",
  open_source: "Open-source contribution",
  coding: "Problem-solving difficulty", topics: "Problem-solving breadth", contest: "Contest performance",
  activity: "Recent coding activity", skills: "Corroborated technical skills", implementation: "Delivered implementation",
  ownership: "Engineering ownership", impact: "Measurable engineering impact", architecture: "Architecture and trade-offs",
  cross_team: "Cross-team technical influence", strategy: "Organization-wide technical strategy", achievements: "Structured achievements",
  industry_contribution: "Cited industry contribution (unverified)",
};

/** Provisional policy, not an empirically calibrated hiring/readiness model. */
export const LEGACY_V1_SCORING_CONFIG: ScoringConfig = deepFreeze({
  version: "profile-beta-v1", beta: true,
  weights: {
    fresher: { coding: 30, topics: 15, contest: 10, activity: 10, skills: 10, implementation: 15, achievements: 10 },
    sde1: { coding: 20, topics: 10, skills: 10, activity: 10, implementation: 25, ownership: 15, achievements: 10 },
    sde2: { coding: 10, skills: 10, implementation: 20, ownership: 25, impact: 20, architecture: 15 },
    sde3: { implementation: 10, ownership: 25, impact: 25, architecture: 30, cross_team: 10 },
    staff: { ownership: 10, impact: 25, architecture: 30, cross_team: 35 },
    principal: { impact: 20, architecture: 20, cross_team: 20, strategy: 40 },
  },
  normalizers: { easyCap: 100, mediumCap: 150, hardCap: 75, topicCap: 10, topicMinimum: 5,
    ratingFloor: 1200, ratingCeiling: 2400, activityCap: 15, activityHalfLifeDays: 30, observationHalfLifeDays: 180 },
  thresholds: { minimumCoverage: 60, minimumConfidence: 60, minimumCohort: 5 },
});

/** Exactly the six rubrics released with v1; never expand its replay policy. */
const V1_LEVELS = ["fresher", "sde1", "sde2", "sde3", "staff", "principal"] as const;

export const LEGACY_V2_SCORING_CONFIG: ScoringConfig = deepFreeze({
  ...structuredClone(LEGACY_V1_SCORING_CONFIG),
  version: "profile-beta-v2",
  weights: {
    ...structuredClone(LEGACY_V1_SCORING_CONFIG.weights),
    intern: { coding: 20, topics: 15, activity: 15, skills: 10, implementation: 30, achievements: 10 },
    distinguished: { impact: 15, architecture: 15, cross_team: 10, strategy: 30, industry_contribution: 30 },
  },
});

/** V3 adds consented LinkedIn imports; all component weights and numerical policy remain v2. */
export const LEGACY_V3_SCORING_CONFIG: ScoringConfig = deepFreeze({
  ...structuredClone(LEGACY_V2_SCORING_CONFIG), version: "profile-beta-v3",
});

/** V4 adds the Firecrawl receipt whitelist; weights and trust policy are exactly v3. */
export const DEFAULT_SCORING_CONFIG: ScoringConfig = deepFreeze({
  ...structuredClone(LEGACY_V3_SCORING_CONFIG), version: "profile-beta-v4",
});
export const LEGACY_V4_SCORING_CONFIG = DEFAULT_SCORING_CONFIG;

/**
 * V5 is deliberately additive. V4 remains the default replay policy because persisted v4
 * snapshots and their hashes are contractual. Consumers that opt into the enhanced policy
 * should pass this config explicitly (or use CURRENT_SCORING_CONFIG).
 */
export const PROFILE_BETA_V5_SCORING_CONFIG: ScoringConfig = deepFreeze({
  version: "profile-beta-v5", beta: true,
  // Product policy. At every level engineering scope (implementation, ownership, impact,
  // architecture, cross-team, strategy) outweighs open source, and open source outweighs both
  // DSA + competitive programming and projects. DSA + CP is 19% for intern/fresher, 16% at SDE-1 and ~2% from Staff. Entry levels are
  // judged mostly on what was built and shipped (projects, internships, open source); from SDE-1
  // professional work dominates; from SDE-3 scope (impact, architecture, cross-team, strategy)
  // dominates. Missing components renormalize away, so a profile without open source is not penalized.
  weights: {
    intern: { problem_solving: 14, competitive_programming: 5, projects: 18, internship_experience: 8, implementation: 11, ownership: 7, impact: 5, architecture: 3, skills: 4, achievements: 6, open_source: 19 },
    fresher: { problem_solving: 14, competitive_programming: 5, projects: 17, internship_experience: 12, professional_experience: 3, implementation: 9, ownership: 6, impact: 4, architecture: 3, skills: 3, achievements: 6, open_source: 18 },
    sde1: { problem_solving: 12, competitive_programming: 4, projects: 10, internship_experience: 4, professional_experience: 18, implementation: 10, ownership: 9, impact: 7, architecture: 5, skills: 2, achievements: 5, open_source: 14 },
    sde2: { problem_solving: 3, competitive_programming: 2, projects: 4, internship_experience: 1, professional_experience: 24, implementation: 11, ownership: 15, impact: 14, architecture: 13, cross_team: 2, skills: 1, open_source: 10 },
    sde3: { problem_solving: 2, competitive_programming: 1, projects: 2, professional_experience: 22, implementation: 9, ownership: 14, impact: 17, architecture: 18, cross_team: 5, open_source: 10 },
    staff: { problem_solving: 1, competitive_programming: 1, professional_experience: 18, implementation: 5, ownership: 12, impact: 19, architecture: 18, cross_team: 12, strategy: 4, open_source: 10 },
    principal: { problem_solving: 1, competitive_programming: 1, professional_experience: 15, implementation: 3, ownership: 10, impact: 20, architecture: 18, cross_team: 12, strategy: 9, open_source: 11 },
    distinguished: { problem_solving: 1, competitive_programming: 1, professional_experience: 12, implementation: 2, ownership: 8, impact: 20, architecture: 18, cross_team: 10, strategy: 16, open_source: 12 },
  },
  normalizers: {
    ...structuredClone(DEFAULT_SCORING_CONFIG.normalizers),
    cpDifficultyCap: 100,
    cpBreadthCap: 12,
    cpConsistencyCap: 12,
    cpRecencyHalfLifeDays: 180,
    cpTrajectoryWindowDays: 365,
    contestRecencyHalfLifeDays: 90,
    // 2 weeks ~ 11, 1 month ~ 21, 3 months 50, 6 months 75, 12 months ~ 94: diminishing returns.
    internshipDurationHalfLifeMonths: 3,
    internshipCompanyContextCap: 10,
    experienceTenureHalfLifeMonths: 24,
    experienceRecencyHalfLifeMonths: 36,
    // Open source: no star floor; a merged PR to any repository the user does not own counts.
    ossMinRepoStars: 0,
    ossContributionHalfCount: 5,
    ossRecencyHalfLifeDays: 365,
  },
  thresholds: structuredClone(DEFAULT_SCORING_CONFIG.thresholds),
  v5Policy: {
    competition: {
      // Ratings mean different things on each platform: every platform maps its own scale through
      // its own tier anchors before anything is compared or combined. Anchors are provisional.
      platforms: {
        leetcode: { difficultyCaps: { easy: 100, medium: 150, hard: 75 }, difficultyWeights: { easy: 15, medium: 50, hard: 35 }, ratingFloor: 1200, ratingCeiling: 2800, activityCap: 15,
          // ~1500 median contestant, 1850 Knight (~top 5%), 2150 Guardian (~top 1%).
          ratingCurve: [[1200, 0], [1500, 35], [1700, 55], [1850, 70], [2000, 80], [2150, 88], [2400, 95], [2800, 100]],
          contestParticipationCap: 24, advancedTopicCap: 8, volatilityScale: 150 },
        codeforces: { difficultyCaps: { easy: 100, medium: 100, hard: 50 }, difficultyWeights: { easy: 15, medium: 45, hard: 40 }, ratingFloor: 800, ratingCeiling: 3000, activityCap: 30,
          // Pupil 1200, Specialist 1400, Expert 1600, CM 1900, Master 2100, IM 2300, GM 2400.
          ratingCurve: [[800, 0], [1200, 25], [1400, 45], [1600, 62], [1900, 78], [2100, 86], [2300, 91], [2400, 94], [2600, 97], [3000, 100]],
          contestParticipationCap: 24, advancedTopicCap: 8, volatilityScale: 200,
          advancedTags: ["dp", "graphs", "trees", "number theory", "divide and conquer", "flows", "fft", "string suffix structures", "2-sat", "games", "geometry", "data structures", "bitmasks", "graph matchings", "shortest paths", "dsu", "combinatorics", "probabilities", "matrices"] },
        codechef: { difficultyCaps: { easy: 100, medium: 100, hard: 50 }, difficultyWeights: { easy: 15, medium: 45, hard: 40 }, ratingFloor: 1000, ratingCeiling: 2800, activityCap: 20,
          // 2* 1400, 3* 1600, 4* 1800, 5* 2000, 6* 2200, 7* 2500.
          ratingCurve: [[1000, 0], [1400, 25], [1600, 45], [1800, 62], [2000, 75], [2200, 85], [2500, 95], [2800, 100]],
          contestParticipationCap: 12, advancedTopicCap: 8, volatilityScale: 200 },
        atcoder: { difficultyCaps: { easy: 100, medium: 100, hard: 50 }, difficultyWeights: { easy: 15, medium: 45, hard: 40 }, ratingFloor: 0, ratingCeiling: 3200, activityCap: 20,
          // Brown 400, Green 800, Cyan 1200, Blue 1600, Yellow 2000, Orange 2400, Red 2800.
          ratingCurve: [[0, 0], [400, 15], [800, 35], [1200, 55], [1600, 72], [2000, 85], [2400, 93], [2800, 98], [3200, 100]],
          contestParticipationCap: 24, advancedTopicCap: 8, volatilityScale: 200 },
        hackerearth: { difficultyCaps: { easy: 100, medium: 80, hard: 40 }, difficultyWeights: { easy: 20, medium: 50, hard: 30 }, ratingFloor: 1000, ratingCeiling: 2500, activityCap: 20,
          ratingCurve: [[1000, 0], [1500, 40], [1800, 60], [2100, 80], [2500, 100]], contestParticipationCap: 12, advancedTopicCap: 6, volatilityScale: 200 },
        // takeUforward: no rating; Basic/Core/Pro sheets map to easy/medium/hard problem solving.
        tuf: { difficultyCaps: { easy: 120, medium: 250, hard: 100 }, difficultyWeights: { easy: 10, medium: 50, hard: 40 }, ratingFloor: 0, ratingCeiling: 1, activityCap: 20, advancedTopicCap: 6,
          advancedTags: ["dynamic programming", "graphs", "tries", "advanced range data structures", "bit manipulation", "binary search trees", "heaps", "ordered sets & maps"] },
        generic: { difficultyCaps: { easy: 100, medium: 150, hard: 75 }, difficultyWeights: { easy: 15, medium: 50, hard: 35 }, ratingFloor: 1000, ratingCeiling: 2400, activityCap: 20,
          ratingCurve: [[1000, 0], [2400, 100]], contestParticipationCap: 12, advancedTopicCap: 6, volatilityScale: 200 },
      },
      // Legacy v5 signal list (kept for audit traces); composition now lives in subFeatures.
      signalWeights: { difficulty: 20, contest: 35, breadth: 15, consistency: 10, recency: 10, trajectory: 10 },
    },
    internship: { companyContextMaximumWeight: 5 },
    results: {
      // Participation < qualification < finalist < top-ranked < winner; scaled by event metadata.
      statusScores: { participation: 20, qualification: 40, selected: 55, finalist: 60, completed: 70, top_ranked: 75, winner: 90 },
      unknownEventFactor: 0.6,
    },
    assessment: { maximumConfidence: 45, maximumInfluence: 0.15, maximumScore: 85, allowedDimensions: ["implementation", "ownership", "impact", "architecture", "cross_team", "strategy", "skills"] },
    // Every composite component is a weighted mean over ALL its sub-features: one with no data counts
    // as 0 (`missingCountsAsZero`), except within an `alternatives` group. Weights are relative and
    // level-specific.
    subFeatures: {
      problem_solving: { default: { difficulty: 40, breadth: 20, advanced_topics: 15, solving_consistency: 15, solving_recency: 10 } },
      // Spec starting weights; problem difficulty/breadth are scored once, in problem_solving.
      competitive_programming: {
        default: { leetcode_contest: 25, codeforces_contest: 30, other_contest: 15, contest_trajectory: 10, contest_consistency: 10, contest_recency: 5, rating_stability: 3, competition_results: 15 },
        sde2: { leetcode_contest: 20, codeforces_contest: 25, other_contest: 12, contest_trajectory: 5, contest_consistency: 5, contest_recency: 2, rating_stability: 2, competition_results: 30 },
        sde3: { leetcode_contest: 20, codeforces_contest: 25, other_contest: 12, contest_trajectory: 5, contest_consistency: 5, contest_recency: 2, rating_stability: 2, competition_results: 30 },
        staff: { leetcode_contest: 15, codeforces_contest: 20, other_contest: 10, contest_trajectory: 3, contest_consistency: 3, contest_recency: 1, rating_stability: 1, competition_results: 45 },
        principal: { leetcode_contest: 15, codeforces_contest: 20, other_contest: 10, contest_trajectory: 3, contest_consistency: 3, contest_recency: 1, rating_stability: 1, competition_results: 45 },
        distinguished: { leetcode_contest: 15, codeforces_contest: 20, other_contest: 10, contest_trajectory: 3, contest_consistency: 3, contest_recency: 1, rating_stability: 1, competition_results: 45 },
      },
      projects: {
        default: { technical_complexity: 20, technical_depth: 18, production_readiness: 14, engineering_practices: 10, originality: 10, impact_significance: 10, design_tradeoffs: 6, ownership_scope: 4, scale: 3, delivery_signals: 3, tech_stack_breadth: 2 },
        sde2: { technical_complexity: 18, technical_depth: 16, production_readiness: 12, engineering_practices: 10, originality: 4, impact_significance: 12, design_tradeoffs: 14, ownership_scope: 6, scale: 6, delivery_signals: 1, tech_stack_breadth: 1 },
        sde3: { technical_complexity: 18, technical_depth: 16, production_readiness: 12, engineering_practices: 10, originality: 4, impact_significance: 12, design_tradeoffs: 14, ownership_scope: 6, scale: 6, delivery_signals: 1, tech_stack_breadth: 1 },
      },
      // Spec 2.13 starting weights for entry levels.
      internship_experience: { default: { technical_depth: 25, role_relevance: 15, ownership: 15, production_exposure: 10, impact: 15, company_context: 5, duration: 5, engineering_practices: 5, scale: 2, outcome: 3 } },
      professional_experience: {
        default: { technical_depth: 18, ownership_scope: 15, impact_significance: 15, production_exposure: 12, role_relevance: 10, design_tradeoffs: 8, engineering_practices: 6, scale: 6, tenure: 6, recency: 4, company_context: 3 },
        sde3: { technical_depth: 14, ownership_scope: 15, impact_significance: 17, production_exposure: 8, role_relevance: 6, design_tradeoffs: 14, engineering_practices: 6, scale: 8, tenure: 5, recency: 3, cross_team_influence: 4, company_context: 2 },
        staff: { technical_depth: 10, ownership_scope: 12, impact_significance: 18, production_exposure: 5, role_relevance: 4, design_tradeoffs: 14, engineering_practices: 5, scale: 8, tenure: 4, recency: 3, cross_team_influence: 10, technical_leadership: 7, strategy_scope: 6, company_context: 2 },
        principal: { technical_depth: 8, ownership_scope: 10, impact_significance: 18, production_exposure: 4, role_relevance: 4, design_tradeoffs: 14, engineering_practices: 4, scale: 8, tenure: 4, recency: 3, cross_team_influence: 10, technical_leadership: 7, strategy_scope: 10, company_context: 2 },
        distinguished: { technical_depth: 6, ownership_scope: 8, impact_significance: 18, production_exposure: 3, role_relevance: 3, design_tradeoffs: 14, engineering_practices: 4, scale: 8, tenure: 4, recency: 2, cross_team_influence: 10, technical_leadership: 6, strategy_scope: 14, company_context: 2 },
      },
      skills: { default: { github_corroboration: 100 } },
      open_source: {
        default: { merged_contributions: 30, project_reach: 25, contribution_depth: 20, distinct_projects: 15, recency: 10 },
        // Entry levels: one or two substantial merged PRs to a real project are a strong signal; volume is not expected.
        intern: { merged_contributions: 15, project_reach: 35, contribution_depth: 35, distinct_projects: 5, recency: 10 },
        fresher: { merged_contributions: 15, project_reach: 35, contribution_depth: 35, distinct_projects: 5, recency: 10 },
        sde1: { merged_contributions: 20, project_reach: 30, contribution_depth: 30, distinct_projects: 10, recency: 10 },
        staff: { merged_contributions: 25, project_reach: 30, contribution_depth: 25, distinct_projects: 15, recency: 5 },
        principal: { merged_contributions: 25, project_reach: 30, contribution_depth: 25, distinct_projects: 15, recency: 5 },
        distinguished: { merged_contributions: 25, project_reach: 30, contribution_depth: 25, distinct_projects: 15, recency: 5 },
      },
      achievements: { default: { hackathons: 50, oss_programs: 35, other_recognition: 15 } },
    },
    semantic: {
      promptVersion: "profile-scoring-assessment-prompt-v5",
      maximumItems: { project: 8, experience: 8, internship: 6 },
      features: {
        project: [
          { key: "technical_complexity", description: "How non-trivial the engineering is for the candidate's level (a tutorial CRUD app is low; real concurrency, data, auth, performance or algorithmic work is higher)." },
          { key: "technical_depth", description: "Depth of understanding shown in the stack used (data modeling, APIs, caching, testing strategy, performance), judged from evidence, not technology names alone." },
          { key: "originality", description: "Is this a self-directed, original problem rather than a course/tutorial clone?" },
          { key: "production_readiness", description: "Deployed and used (real users, live service) versus prototype or demo; only from explicit evidence." },
          { key: "engineering_practices", description: "Testing, CI/CD, code review, documentation, monitoring or security practices explicitly evidenced." },
          { key: "impact_significance", description: "Believable, evidenced outcomes (users, adoption, measured improvements) relative to the candidate's level; vague claims score low." },
          { key: "design_tradeoffs", description: "Explicit design or architecture decisions and trade-offs (scalability, reliability, consistency, data modeling)." },
          { key: "ownership_scope", description: "Did the candidate build/own it end to end, versus contributing a small part of a team project?" },
          { key: "scale", description: "Evidenced scale: users, requests, data volume or deployment footprint. Unstated scale is unknown, not low." },
        ],
        experience: [
          { key: "role_relevance", description: "Relevance of the role and actual work to software engineering (SWE/backend/frontend/ML/data/SRE high; non-technical roles low but not zero if technical work is evidenced)." },
          { key: "technical_depth", description: "Technical depth of the work actually performed, relative to the candidate's level, judged from evidence rather than technology names." },
          { key: "ownership_scope", description: "Scope owned: assisted < contributed < owned a feature < owned a service/system < led a project or multiple systems." },
          { key: "production_exposure", description: "Did the work reach production users (production > internal production > staging > prototype > demo)?" },
          { key: "scale", description: "Evidenced scale of the systems/users/data involved. Unstated scale is unknown, not low." },
          { key: "impact_significance", description: "Significance and credibility of measured outcomes (latency, cost, reliability, revenue, productivity) relative to the candidate's level." },
          { key: "design_tradeoffs", description: "System design and architecture decisions with explicit trade-offs (distributed systems, data architecture, reliability, scalability)." },
          { key: "engineering_practices", description: "Engineering excellence evidenced: testing strategy, CI/CD, observability, code review, incident handling, security." },
          { key: "cross_team_influence", description: "Technical influence beyond the immediate team: cross-team design, standards, migrations adopted by other teams." },
          { key: "technical_leadership", description: "Technical leadership: mentoring, leading design reviews, guiding other engineers, owning technical direction for a team." },
          { key: "strategy_scope", description: "Organization-wide technical strategy, roadmaps or long-term platform direction explicitly evidenced." },
        ],
        internship: [
          { key: "role_relevance", description: "Relevance of the internship role and work to software engineering (SWE high; QA/IT medium; marketing/business/operations low unless technical work is evidenced)." },
          { key: "technical_depth", description: "Complexity of the technical work: basic < intermediate < advanced < highly complex, from evidence (using React alone is not advanced)." },
          { key: "ownership", description: "Assisted < contributed < owned a feature < owned a subsystem < owned a project < led a project. 'Worked on' alone is contribution, not ownership." },
          { key: "production_exposure", description: "Production > internal production > staging > prototype > proof of concept > academic demo; unknown when not stated." },
          { key: "scale", description: "Evidenced users, requests, data volume or services affected. Unstated scale is unknown, not low." },
          { key: "impact", description: "Measured impact (time saved, latency, cost, users, automation, bugs reduced); vague claims score low." },
          { key: "engineering_practices", description: "Code reviews, testing, CI/CD, monitoring, documentation or deployment explicitly evidenced; distinguishes production features from isolated tasks." },
          { key: "outcome", description: "Return offer, pre-placement offer, extension or full-time conversion only when explicitly stated." },
        ],
      },
      dimensions: {
        implementation: { semanticFeatures: ["technical_depth", "technical_complexity", "production_readiness", "production_exposure"], claimWeight: 40, semanticWeight: 60 },
        ownership: { semanticFeatures: ["ownership_scope", "ownership"], claimWeight: 40, semanticWeight: 60 },
        impact: { semanticFeatures: ["impact_significance", "impact"], claimWeight: 40, semanticWeight: 60 },
        architecture: { semanticFeatures: ["design_tradeoffs"], claimWeight: 40, semanticWeight: 60 },
        cross_team: { semanticFeatures: ["cross_team_influence", "technical_leadership"], claimWeight: 50, semanticWeight: 50 },
        strategy: { semanticFeatures: ["strategy_scope"], claimWeight: 50, semanticWeight: 50 },
      },
    },
    // SDE-1+: internships count toward professional experience as a discounted historical signal.
    internshipInExperience: { sde1: 0.6, sde2: 0.4, sde3: 0.25, staff: 0.15, principal: 0.1, distinguished: 0.1 },
    itemAggregation: { additionalItemWeights: [0.15, 0.1, 0.05] },
    // No minimum: every scored profile that opts in is listed at its level. Missing core parts already
    // count as 0 in the score, so coverage is shown for explanation only.
    minimumCoverageByLevel: { intern: 0, fresher: 0, sde1: 0, sde2: 0, sde3: 0, staff: 0, principal: 0, distinguished: 0 },
    // What every candidate at the level is expected to show (missing = 0). Everything else is a bonus
    // that only adds: contests, open source, achievements, skills corroboration, and anything that is
    // optional or rare at that level (internships for students, side projects for working engineers,
    // DSA profiles from SDE-2, hands-on implementation claims from Staff).
    coreComponents: {
      intern: ["problem_solving", "projects", "implementation"],
      fresher: ["problem_solving", "projects", "implementation"],
      sde1: ["problem_solving", "professional_experience", "implementation", "ownership"],
      sde2: ["professional_experience", "implementation", "ownership", "impact", "architecture"],
      sde3: ["professional_experience", "implementation", "ownership", "impact", "architecture"],
      staff: ["professional_experience", "ownership", "impact", "architecture", "cross_team"],
      principal: ["professional_experience", "ownership", "impact", "architecture", "cross_team", "strategy"],
      distinguished: ["professional_experience", "ownership", "impact", "architecture", "cross_team", "strategy"],
    },
    // Required parts are never left out: missing, failed or not-yet-run evidence counts as 0.
    missingCountsAsZero: true,
    // The same signal from different platforms: any one present satisfies the group, so a LeetCode-only
    // candidate is never scored 0 for "no Codeforces contest". Only a whole absent group counts as 0.
    // The overall score is a plain weighted sum over every part (missing = 0); see engineV5 section 6.
    formula: "weighted_sum",
    alternatives: {
      // A contest record on any platform, or listed contest results (ICPC and the like), is one signal.
      competitive_programming: [["leetcode_contest", "codeforces_contest", "other_contest", "competition_results"]],
      // A hackathon win, an open-source programme (GSoC) or other recognition are each a recognition.
      achievements: [["hackathons", "oss_programs", "other_recognition"]],
    },
  },
});
export const V5_SCORING_CONFIG = PROFILE_BETA_V5_SCORING_CONFIG;

export const CURRENT_SCORING_CONFIG = PROFILE_BETA_V5_SCORING_CONFIG;

/**
 * Bump when scoring CODE changes without a config change (a parser fix, a corrected rule). It is part of every
 * input fingerprint, so snapshots cached under the old behaviour are recomputed on next read instead of being
 * served stale until the week turns. Past snapshots stay in history untouched.
 */
export const SCORING_ENGINE_REVISION = "r2";

export const linkedInProvider = (provider: unknown, version: string): "exa" | "firecrawl" | null =>
  provider === "exa" ? "exa" : provider === "firecrawl" && supportsLinkedIn(version) && version !== "profile-beta-v3" ? "firecrawl" : null;

export const supportsLinkedIn = (version: string): boolean => version !== "profile-beta-v1" && version !== "profile-beta-v2";

export function validateScoringConfig(config: ScoringConfig): void {
  if (!config || typeof config.version !== "string" || !/^[a-zA-Z0-9._-]{1,80}$/.test(config.version)
    || typeof config.beta !== "boolean") throw new Error("Invalid scoring version/beta configuration");
  const levels = config.version === "profile-beta-v1" ? V1_LEVELS : ENGINEERING_LEVELS;
  if (!config.weights || Object.keys(config.weights).length !== levels.length
    || Object.keys(config.weights).some((level) => !(levels as readonly string[]).includes(level))) {
    throw new Error(config.version === "profile-beta-v1" ? "Exactly the six legacy v1 level weights are required" : "All eight level weights are required");
  }
  for (const level of levels) {
    const weights = config.weights[level];
    if (!weights || !Object.keys(weights).length) throw new Error(`Missing weights for ${level}`);
    for (const [id, weight] of Object.entries(weights)) {
      if (!Object.hasOwn(COMPONENT_LABELS, id) || (config.version === "profile-beta-v1" && id === "industry_contribution")
        || !Number.isFinite(weight) || weight < 0 || weight > 100) throw new Error(`Invalid weight ${level}.${id}`);
    }
    if (Math.abs(Object.values(weights).reduce((sum, value) => sum + value, 0) - 100) > 1e-8) throw new Error(`Weights for ${level} must sum to 100`);
  }
  for (const key of Object.keys(DEFAULT_SCORING_CONFIG.normalizers)) {
    if (!Number.isFinite(config.normalizers?.[key]) || config.normalizers[key]! <= 0) throw new Error(`Invalid normalizer ${key}`);
  }
  for (const key of Object.keys(config.normalizers ?? {})) {
    const value = config.normalizers?.[key];
    // The open-source star floor may be 0 (no floor); every other normalizer is a positive scale.
    if (!Number.isFinite(value) || (key === "ossMinRepoStars" ? value! < 0 : value! <= 0)) throw new Error(`Invalid normalizer ${key}`);
  }
  const allowedNormalizers = new Set([...Object.keys(DEFAULT_SCORING_CONFIG.normalizers), "cpDifficultyCap", "cpBreadthCap", "cpConsistencyCap", "cpRecencyHalfLifeDays", "cpTrajectoryWindowDays", "contestRecencyHalfLifeDays", "internshipDurationHalfLifeMonths", "internshipCompanyContextCap", "experienceTenureHalfLifeMonths", "experienceRecencyHalfLifeMonths",
    "ossMinRepoStars", "ossContributionHalfCount", "ossRecencyHalfLifeDays"]);
  if (Object.keys(config.normalizers).some((key) => !allowedNormalizers.has(key))
    || config.normalizers.ratingCeiling! <= config.normalizers.ratingFloor!) throw new Error("Invalid normalization configuration");
  for (const key of ["minimumCoverage", "minimumConfidence"] as const) {
    const value = config.thresholds?.[key];
    if (!Number.isFinite(value) || value! <= 0 || value! > 100) throw new Error(`Invalid threshold ${key}`);
  }
  if (!Number.isInteger(config.thresholds?.minimumCohort) || config.thresholds.minimumCohort < 2) throw new Error("minimumCohort must be an integer >= 2");
  if (config.version === "profile-beta-v5") validateV5Policy(config);
}

function validateV5Policy(config: ScoringConfig): void {
  const policy = config.v5Policy;
  if (!policy) throw new Error("V5 requires enhanced scoring policy");
  const finite = (x: unknown, min = 0, max = 100) => typeof x === "number" && Number.isFinite(x) && x >= min && x <= max;
  /** Relative sub-feature weights: renormalized over available evidence, so only positivity matters. */
  const relative = (value: Record<string, number> | undefined, what: string) => {
    if (!value || !Object.keys(value).length || Object.values(value).some((x) => !finite(x)) || Object.values(value).reduce((a, b) => a + b, 0) <= 0
      || Object.keys(value).some((key) => !/^[a-z][a-z0-9_]{0,60}$/.test(key))) throw new Error(`Invalid v5 weights for ${what}`);
  };
  relative(policy.competition.signalWeights, "competition signals");
  for (const [name, platform] of Object.entries(policy.competition.platforms)) {
    relative(platform.difficultyWeights, `${name} difficulty`);
    if (!finite(platform.ratingFloor, 0, 10_000) || !finite(platform.ratingCeiling, 0, 10_000) || platform.ratingCeiling <= platform.ratingFloor
      || !finite(platform.activityCap, 1e-9, 10_000)
      || Object.keys(platform.difficultyWeights).some((key) => !finite(platform.difficultyCaps[key], 1e-9, 10_000_000))) throw new Error("Invalid platform normalizer");
    const curve = platform.ratingCurve;
    if (curve && (curve.length < 2 || curve.some(([rating, value], i) => !finite(rating, 0, 10_000) || !finite(value)
      || (i > 0 && (rating <= curve[i - 1]![0] || value < curve[i - 1]![1]))))) throw new Error(`Rating curve for ${name} must be strictly increasing in rating and non-decreasing in value`);
    for (const key of ["contestParticipationCap", "advancedTopicCap", "volatilityScale"] as const) {
      if (platform[key] !== undefined && !finite(platform[key], 1e-9, 10_000)) throw new Error(`Invalid ${key} for ${name}`);
    }
  }
  for (const [component, levels] of Object.entries(policy.subFeatures)) {
    if (!Object.hasOwn(COMPONENT_LABELS, component)) throw new Error(`Unknown composite component ${component}`);
    relative(levels.default, `${component}.default`);
    for (const [level, weights] of Object.entries(levels)) {
      if (level !== "default" && !(ENGINEERING_LEVELS as readonly string[]).includes(level)) throw new Error(`Unknown level ${level} in ${component}`);
      relative(weights, `${component}.${level}`);
    }
  }
  // Company context may contribute but never dominate: its relative share is capped everywhere.
  const companyCap = policy.internship.companyContextMaximumWeight;
  if (!finite(companyCap, 0, 5)) throw new Error("Company context cap must be between 0 and 5 percent");
  for (const [component, levels] of Object.entries(policy.subFeatures)) for (const weights of Object.values(levels)) {
    const total = Object.values(weights!).reduce((a, b) => a + b, 0);
    if ((weights!.company_context ?? 0) / total * 100 > companyCap + 1e-9) throw new Error(`Company context weight exceeds cap in ${component}`);
  }
  if (Object.values(policy.results.statusScores).some((x) => !finite(x)) || !finite(policy.results.unknownEventFactor, 0, 1)) throw new Error("Invalid competition result policy");
  const semantic = policy.semantic;
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(semantic.promptVersion)) throw new Error("Invalid semantic policy");
  for (const [type, features] of Object.entries(semantic.features)) {
    const keys = features.map((feature) => feature.key);
    if (!keys.length || keys.length > 24 || new Set(keys).size !== keys.length || keys.some((key) => !/^[a-z][a-z0-9_]{0,60}$/.test(key))
      || features.some((feature) => !feature.description || feature.description.length > 500)) throw new Error(`Invalid semantic features for ${type}`);
    if (!finite(semantic.maximumItems[type as keyof typeof semantic.maximumItems], 0, 20)) throw new Error(`Invalid semantic item cap for ${type}`);
  }
  for (const [dimension, rule] of Object.entries(semantic.dimensions)) {
    if (!Object.hasOwn(COMPONENT_LABELS, dimension) || !rule.semanticFeatures.length || !finite(rule.claimWeight) || !finite(rule.semanticWeight)
      || rule.claimWeight + rule.semanticWeight <= 0) throw new Error(`Invalid semantic dimension ${dimension}`);
  }
  if (Object.entries(policy.internshipInExperience).some(([level, factor]) => !(ENGINEERING_LEVELS as readonly string[]).includes(level) || !finite(factor, 0, 1))) throw new Error("Invalid internship-in-experience factors");
  if (!policy.itemAggregation.additionalItemWeights.every((x) => finite(x, 0, 1))) throw new Error("Invalid item aggregation weights");
  if (Object.entries(policy.minimumCoverageByLevel).some(([level, value]) => !(ENGINEERING_LEVELS as readonly string[]).includes(level) || !finite(value, 0, 100))) throw new Error("Invalid minimum coverage by level");
  for (const level of ENGINEERING_LEVELS) {
    const core = policy.coreComponents[level], weights = config.weights[level] ?? {};
    if (!Array.isArray(core) || !core.length || new Set(core).size !== core.length || core.some((id) => !(weights[id]! > 0))) throw new Error(`Invalid core components for ${level}`);
  }
  if (policy.missingCountsAsZero !== undefined && typeof policy.missingCountsAsZero !== "boolean") throw new Error("Invalid missing-counts-as-zero flag");
  if (policy.formula !== undefined && !["core_base_bonus_lift", "weighted_sum"].includes(policy.formula)) throw new Error("Invalid formula");
  for (const [component, groups] of Object.entries(policy.alternatives ?? {})) {
    const keys = new Set(Object.keys(policy.subFeatures[component]?.default ?? {}));
    if (!Array.isArray(groups) || groups.some((group) => !Array.isArray(group) || group.length < 2 || group.some((key) => !keys.has(key)))) throw new Error(`Invalid alternatives for ${component}`);
  }
  const assessment = policy.assessment;
  if (!Number.isFinite(assessment.maximumConfidence) || assessment.maximumConfidence <= 0 || assessment.maximumConfidence > 45
    || !Number.isFinite(assessment.maximumScore) || assessment.maximumScore < 0 || assessment.maximumScore > 100
    || !Number.isFinite(assessment.maximumInfluence) || assessment.maximumInfluence < 0 || assessment.maximumInfluence > 0.25
    || !Array.isArray(assessment.allowedDimensions) || assessment.allowedDimensions.some((key) => !Object.hasOwn(COMPONENT_LABELS, key) || key === "problem_solving")) throw new Error("Invalid inferred assessment policy");
}
