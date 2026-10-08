/** Separate deterministic beta assessment; never part of ProfileSummary or interview outcomes. */
import type { EngineeringLevel } from "../engineeringLevels.js";
export { ENGINEERING_LEVELS } from "../engineeringLevels.js";
export type { EngineeringLevel } from "../engineeringLevels.js";

export interface ScoringProfile {
  headline: string | null;
  education: { degree: string | null; field: string | null; grade: string | null; startYear: string | null; endYear: string | null }[];
  experience: { title: string | null; startDate: string | null; endDate: string | null; bullets: string[] | null }[];
  projects: { name: string | null; description: string | null; tech: string[] | null; bullets: string[] | null; link: string | null }[];
  skills: string[];
  achievements: string[];
}

export interface ScoringFragment {
  source: string;
  data: Record<string, unknown>;
  contentHash: string;
  fetchedAt: string;
}

export interface ScoringInput {
  asOf: string;
  declaredLevel: EngineeringLevel | null;
  profile: ScoringProfile | null;
  fragments: ScoringFragment[];
  /** Optional persisted, model-produced assessments. V5 accepts these only through its contract. */
  llmAssessments?: StoredLLMAssessment[];
  /** Optional structured internship records supplied by a trusted local adapter. */
  internships?: InternshipRecord[];
  /**
   * V5: stored per-item semantic sub-feature assessments (projects, experience, internships).
   * Produced outside the engine by the batch producer; the engine only reads them and only uses
   * one whose item hash, level and prompt version match the item currently being scored.
   */
  semanticAssessments?: SemanticItemAssessment[];
}

export type SemanticItemType = "project" | "experience" | "internship";

/** One semantic (LLM-inferred) sub-feature judgment for one profile item. Never an overall score. */
export interface SemanticFeatureValue {
  key: string;
  value: number;
  excerpts: string[];
  rationale: string | null;
}

export interface SemanticItemAssessment {
  itemType: SemanticItemType;
  itemHash: string;
  level: EngineeringLevel;
  promptVersion: string;
  features: SemanticFeatureValue[];
  /** Deterministically resolved company context (0-100) for internships/experience; never a name. */
  companyContext?: { value: number; source: string } | null;
  assessedAt: string | null;
  model: string | null;
}

export type EvidenceType = "DIRECT" | "DERIVED" | "INFERRED" | "SELF_REPORTED" | "UNAVAILABLE";

export interface EvidenceSourceMetadata {
  platform?: string | null;
  adapter?: string | null;
  recordId?: string | null;
  retrievedAt?: string | null;
  observedAt?: string | null;
  verificationMethod?: string | null;
}

/** Stored contract only; the scoring engine never calls an LLM. */
export interface StoredLLMAssessment {
  id?: string;
  dimension: string;
  score: number;
  confidence?: number;
  evidenceRefs: string[];
  assessedAt?: string | null;
  model?: string | null;
  source?: string | null;
  inputHash?: string | null;
}

export interface InternshipRecord {
  id?: string;
  company?: string | null;
  title?: string | null;
  role?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  employmentType?: string | null;
  domain?: string | null;
  technologies?: string[];
  project?: string | null;
  responsibilities?: string[];
  roleRelevance?: number | null;
  durationMonths?: number | null;
  technicalDepth?: number | null;
  ownership?: number | null;
  productionExposure?: number | null;
  scale?: number | null;
  impact?: number | null;
  practices?: number | null;
  outcome?: number | null;
  companyContext?: number | null;
  observedAt?: string | null;
  source?: string | null;
}

export interface ScoreEvidence {
  id: string;
  /** V5: sub-feature key this evidence supports (e.g. "codeforces_contest", "technical_depth"). */
  feature?: string;
  source: string;
  path: string;
  claim: string;
  value: string | number;
  confidence: number;
  observedAt: string | null;
  verification: "collector" | "self_reported";
  recencyFactor: number;
  /** V3 only: corroborating paths are attribution, never additional scoring/confidence credit. */
  paths?: string[];
  provenance?: { section: string; path: string; file: string | null; quote: string }[];
  /** V5 fields are optional so v1-v4 replay serialization is unchanged. */
  rawValue?: unknown;
  normalizedValue?: number | null;
  scoreContribution?: number | null;
  sourceMetadata?: EvidenceSourceMetadata;
  evidenceType?: EvidenceType;
  algorithmVersion?: string;
  sourceUrl?: string | null;
  sourceTimestamp?: string | null;
}

export interface ScoreComponent {
  id: string;
  label: string;
  weight: number;
  score: number | null;
  contribution: number | null;
  evidenceIds: string[];
  /** pending: only on snapshots from configs without `missingCountsAsZero` (an unassessed part was left out). */
  status: "available" | "missing" | "pending";
  /** v5: core parts count as 0 when missing; bonus parts count only when they raise the score. */
  role?: "core" | "bonus";
  /** v5: whether this part is in the score (a missing core part counts as 0; an unhelpful bonus is left out). */
  counted?: boolean;
}

export interface ScoreSource {
  source: string;
  status: "available" | "missing" | "unsupported" | "partial";
  fetchedAt: string | null;
  ageDays: number | null;
  contentHash: string | null;
  /** V3 LinkedIn import receipts describe provenance, never verified employment. */
  importMethod?: "archive" | "pdf" | "text" | "url" | null;
  importedAt?: string | null;
  provider?: "exa" | "firecrawl" | null;
  retrievedAt?: string | null;
}

export interface ScoreClassification {
  declaredLevel: EngineeringLevel | null;
  assessedLevel: EngineeringLevel;
  confidence: number;
  reasons: string[];
  warnings: string[];
}

export interface ScoreEvaluation {
  algorithmVersion: string;
  configHash: string;
  inputHash: string;
  asOf: string;
  status: "scored" | "insufficient_evidence";
  score: number | null;
  confidence: number;
  coverage: number;
  level: EngineeringLevel;
  classification: ScoreClassification;
  components: ScoreComponent[];
  evidence: ScoreEvidence[];
  warnings: string[];
  eligibility: { eligible: boolean; reasons: string[] };
  sources: ScoreSource[];
}

export interface ScoringConfig {
  version: string;
  beta: boolean;
  /** Old six-level v1 configs remain valid replay data; current configs require all eight at runtime. */
  weights: Record<Exclude<EngineeringLevel, "intern" | "distinguished">, Record<string, number>>
    & Partial<Record<"intern" | "distinguished", Record<string, number>>>;
  normalizers: Record<string, number>;
  thresholds: { minimumCoverage: number; minimumConfidence: number; minimumCohort: number };
  /** Present only on enhanced policies; saved legacy JSON remains byte-for-byte unchanged. */
  v5Policy?: {
    competition: {
      platforms: Record<string, PlatformPolicy>;
      signalWeights: Record<string, number>;
    };
    internship: { companyContextMaximumWeight: number };
    /** Competition/hackathon/OSS-program results: outcome ladder, scored with knowledge-base metadata. */
    results: { statusScores: Record<string, number>; unknownEventFactor: number };
    assessment: { maximumConfidence: number; maximumInfluence: number; maximumScore: number; allowedDimensions: string[] };
    /** Composite components: sub-feature weights per level ("default" applies to unlisted levels). */
    subFeatures: Record<string, LevelWeights>;
    /** Item-level semantic sub-features requested from the LLM, per item type. */
    semantic: SemanticPolicy;
    /** Internship evidence also counts toward professional experience at these levels, discounted. */
    internshipInExperience: Partial<Record<EngineeringLevel, number>>;
    /** Credit for additional items beyond the best one (never lowers the score). */
    itemAggregation: { additionalItemWeights: number[] };
    /** Leaderboard eligibility: share of the level's CORE weight that must have evidence (no confidence gate). */
    minimumCoverageByLevel: Partial<Record<EngineeringLevel, number>>;
    /**
     * Core components per level: expected of everyone at that level, so missing evidence counts as 0.
     * Every other weighted component is a bonus: it counts only when it raises the score.
     */
    coreComponents: Record<EngineeringLevel, string[]>;
    /**
     * The score measures what the level requires and what is missing. When true, nothing is ever
     * left out while waiting: a core part with no current evidence (absent, AI failed or not run)
     * counts as 0, and a dimension's claim and AI-judgment parts keep their fixed split, a missing
     * part counting as 0. Interchangeable evidence (the same signal on different platforms) still
     * takes the best available. Absent on older saved configs, which replay unchanged.
     */
    missingCountsAsZero?: boolean;
    /**
     * Per composite component, groups of sub-features that are the same signal from different
     * platforms. One present member satisfies the group; only a wholly absent group counts as 0.
     */
    alternatives?: Record<string, string[][]>;
    /**
     * How the parts combine. "weighted_sum": every part counts in proportion to its weight, missing = 0.
     * Absent (older saved configs): core base + bonus lift, replayed unchanged.
     */
    formula?: "core_base_bonus_lift" | "weighted_sum";
  };
}

export type LevelWeights = { default: Record<string, number> } & Partial<Record<EngineeringLevel, Record<string, number>>>;

export interface PlatformPolicy {
  difficultyCaps: Record<string, number>;
  difficultyWeights: Record<string, number>;
  ratingFloor: number;
  ratingCeiling: number;
  activityCap: number;
  /** Monotonic [rating, normalized 0-100] anchors at the platform's own tier boundaries. */
  ratingCurve?: [number, number][];
  contestParticipationCap?: number;
  /** Distinct advanced topics/tags with enough solves for full advanced-topic credit. */
  advancedTopicCap?: number;
  /** Rating-change standard deviation treated as fully volatile. */
  volatilityScale?: number;
  /** Platform tags counted as advanced when the platform does not tier its own topics. */
  advancedTags?: string[];
}

export interface SemanticFeatureSpec { key: string; description: string }

export interface SemanticPolicy {
  promptVersion: string;
  /** Item caps per refresh so a single profile cannot fan out into unbounded LLM calls. */
  maximumItems: Record<SemanticItemType, number>;
  features: Record<SemanticItemType, SemanticFeatureSpec[]>;
  /** Dimension components refined by item semantics: claim (regex) vs semantic share. */
  dimensions: Record<string, { semanticFeatures: string[]; claimWeight: number; semanticWeight: number }>;
}

export interface ProfileScoreSnapshot extends ScoreEvaluation {
  id: string;
  calculatedAt: string;
  week: string;
  rank: number | null;
  percentile: number | null;
  cohortSize: number;
}

export interface ProfileScoringSettings {
  declaredLevel: EngineeringLevel | null;
  leaderboardOptIn: boolean;
}

export interface ProfileScoreResponse {
  current: ProfileScoreSnapshot | null;
  history: ProfileScoreSnapshot[];
  settings: ProfileScoringSettings;
}

export interface ProfileLeaderboardResponse {
  level: EngineeringLevel;
  algorithmVersion: string;
  week: string;
  total: number;
  entries: { rank: number; displayName: string; score: number; confidence: number; percentile: number | null }[];
}

export interface DiagnosticCheck {
  id: string;
  label: string;
  status: "pass" | "fail" | "warning" | "untested";
  detail: string;
}

export interface ProfileScoringJobStatus {
  enabled: boolean;
  status: "idle" | "running" | "completed" | "failed";
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  lastError: string | null;
  nextDueAt: string | null;
  processed: number;
  failed: number;
}

export interface ProfileDiagnosticsResponse {
  checkedAt: string;
  checks: DiagnosticCheck[];
  score: ProfileScoreResponse | null;
  jobs: ProfileScoringJobStatus;
  methodology: ScoringConfig;
}

export interface ProfileTraceStage {
  id: string;
  status: "completed" | "failed" | "skipped";
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  detail: string;
}

/**
 * One step of the deterministic engine, reported only when a debug sink is passed (the admin live
 * trace). Debug output never changes the evaluation.
 */
export interface EngineDebugEvent { step: string; message: string; detail: Record<string, unknown> }
export type EngineDebugSink = (event: EngineDebugEvent) => void;

/** One line of the streamed admin live trace (NDJSON). `result` carries the final trace. */
export interface LiveTraceEvent {
  seq: number;
  ts: string;
  elapsedMs: number;
  kind: "stage" | "log" | "llm" | "engine" | "result" | "error";
  stage: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  data?: unknown;
}

/** One AI-service call (or reuse) made while preparing the trace. */
export interface ProfileTraceLlmCall {
  callId: string;
  call: "item-assessment" | "company-context";
  status: "completed" | "failed" | "reused" | "skipped";
  itemType: SemanticItemType | null;
  itemTitle: string | null;
  durationMs: number | null;
  detail: string;
  error: { name: string; message: string; stack: string | null } | null;
}

export interface ProfileTraceSource {
  /** RESUME, GITHUB, LEETCODE, LINKEDIN or a coding platform (CODEFORCES, TUF, ...). */
  source: string;
  status: ScoreSource["status"] | "excluded";
  fetchedAt: string | null;
  ageDays: number | null;
  contentHash: string | null;
  extractedFieldCounts: Record<string, number>;
  safeSummary: Record<string, string | number | boolean | null>;
}

export interface ProfileTraceProviderCheck {
  provider: string;
  mode: string;
  configured: boolean;
  used: boolean;
  status: "used" | "not_used" | "failed";
  retrievedAt: string | null;
  reason: string;
}

export interface ProfileTraceComponent extends ScoreComponent {
  availableWeight: number;
  formulaInput: { score: number; weight: number } | null;
  /** v5 sub-features that formed this component: value, relative weight, share, and whether it was found or filled in as 0. */
  subFeatures: { key: string; value: number; weight: number; share: number; status?: "found" | "missing" }[];
}

export interface ProfileLiveTraceResponse {
  traceId: string;
  userId: string;
  startedAt: string;
  finishedAt: string;
  stages: ProfileTraceStage[];
  sources: ProfileTraceSource[];
  providerChecks: ProfileTraceProviderCheck[];
  score: number | null;
  confidence: number;
  coverage: number;
  classification: ScoreClassification;
  algorithm: { version: string; configHash: string; inputHash: string };
  components: ProfileTraceComponent[];
  evidence: ScoreEvidence[];
  eligibility: { eligible: boolean; reasons: string[] };
  warnings: string[];
  formula: { expression: string; availableWeight: number; inputs: ProfileTraceComponent[] };
  snapshot: ProfileScoreSnapshot;
  /** AI-service calls and reuses made by this run (item assessments, company context). */
  llmCalls: ProfileTraceLlmCall[];
  stackTrace: string;
  copyText: string;
}
