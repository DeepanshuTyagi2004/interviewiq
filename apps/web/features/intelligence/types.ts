import type { components } from "@/lib/api-client/generated/schema";
import type { Role } from "@/lib/hooks/useCurrentUser";

export type RunStatus = "idle" | "running" | "completed" | "failed" | "cancelled";

export type LogEntry = {
  seq: number;
  ts: string;
  level: string;
  logger: string;
  message: string;
};

/** Per-stage result counters, e.g. { success, insufficient_data, failed, skipped }. */
export type StageResult = Record<string, number>;

/** One Perplexity request within a combination (initial, then any JSON-retry). */
export type ComboRequest = {
  prompt?: string;
  raw_response?: string;
  citations?: string[];
  ts?: string;
};

/** Verbose per-combination detail captured during a run. `requests` holds EVERY
 *  Perplexity call (prompt + raw result), not just the last one. */
export type ComboDetail = {
  combo: string;
  status?: string;
  data_confidence?: string;
  jd_summary?: string;        // the JD context (capped) sent to Perplexity
  requests?: ComboRequest[];
  brief?: Record<string, unknown> | null;
  stored_doc?: Record<string, unknown> | null;
  error?: string;
};

/** How a source's detected seniority relates to the JD level we asked for.
 *  exact/adjacent = on-level (real level evidence); unknown = post never stated a level;
 *  off = a different seniority bucket (excluded before aggregation). */
export type MatchTier = "exact" | "adjacent" | "unknown" | "off";

/** How well a round is grounded.
 *  evidence_backed = >=1 on-level FIRST-HAND account attests it (may carry named problems);
 *  process_guide = >=1 on-level source describes it but none first-hand (a guide/official/post):
 *  structure only, no named problems; inferred_from_similar = drawn from level-unconfirmed posts /
 *  similar patterns (generic); template = industry-standard round no source covered (generic). */
export type Provenance =
  | "evidence_backed"
  | "process_guide"
  | "inferred_from_similar"
  | "template";

/** One round of the consolidated final experience, tagged with where it came from and how
 *  many on-level sources attest it. */
export type FinalRound = {
  round_number?: number | null;
  type?: string | null;
  format?: string | null;
  topics?: string[];
  problems?: string[];
  difficulty?: string | null;
  provenance?: Provenance;
  evidence_urls?: string[];
  /** # of on-level (exact/adjacent) sources that attest this round. */
  support_count?: number;
  /** # of on-level sources in this brief (the "of N" in "seen in X of N"). */
  source_count_total?: number;
  /** Reported by exactly one source out of several. */
  rare?: boolean;
  /** Sublevels of the attesting sources, e.g. ["fresher","sde1"]. */
  source_sublevels?: string[];
};

/** A source the final experience actually cited (subset of all collected), with the
 *  seniority detected in the post and how it matched the requested combo level. */
export type ChosenSource = {
  url?: string;
  source?: string | null;
  detected_level?: string | null;
  geo?: string | null;
  match_tier?: MatchTier | null;
  /** Back-compat: true when match_tier is exact|adjacent. */
  level_matched?: boolean;
  /** true = one candidate's own account; false = a guide/official page/aggregated post. */
  is_first_hand?: boolean | null;
};

/** Why one collected source did or didn't end up in the final experience.
 *  cited = used by a round (first-hand OR guide/process source — see is_first_hand);
 *  off_geo_excluded = genuine source but outside India, dropped before aggregation;
 *  off_level_excluded = genuine source but a different seniority, dropped before aggregation;
 *  extracted_unused = parsed but not cited; no_process = page describes no concrete interview
 *  process; no_rounds = describes a process but yielded no rounds; extract_failed = LLM error. */
export type SourceStatus =
  | "cited"
  | "off_geo_excluded"
  | "off_level_excluded"
  | "extracted_unused"
  | "no_process"
  | "no_rounds"
  | "extract_failed";

export type SourceFunnelEntry = {
  url?: string;
  title?: string | null;
  source?: string | null;
  detected_level?: string | null;
  geo?: string | null;
  match_tier?: MatchTier | null;
  level_matched?: boolean | null;
  /** true = one candidate's own account; false = a guide/official page/aggregated post. */
  is_first_hand?: boolean | null;
  status?: SourceStatus | string;
  /** Model reasoning for this source. Present only when LLM_CAPTURE_THOUGHTS is on (debug). */
  thought?: string | null;
};

/** The single consolidated round-by-round experience stored under a brief. */
export type FinalExperience = {
  rounds?: FinalRound[];
  dominant_topics?: string[];
  difficulty_calibration?: string | null;
  interviewer_style_notes?: string | null;
  red_flags?: string[];
  company_specific_patterns?: string | null;
  data_confidence?: string;
  /** True when one or more rounds are industry-standard templates (thin real data for this level). */
  template_used?: boolean;
  evidence_backed_round_count?: number;
  /** All non-evidence rounds (process_guide + inferred + template). */
  inferred_round_count?: number;
  /** Rounds attested by on-level guides/official pages/posts (no first-hand account). */
  process_guide_round_count?: number;
  level_matched_round_count?: number;
  chosen_sources?: ChosenSource[];
  source_funnel?: SourceFunnelEntry[];
  /** Model reasoning behind the consolidated experience. Present only when LLM_CAPTURE_THOUGHTS is on. */
  aggregate_thought?: string | null;
};

/** Shape returned by the backend proxy (passthrough of the AI service's run state). */
export type ScrapeStatus = {
  run_id: string | null;
  status: RunStatus;
  trigger: string | null;
  stage: string | null;
  started_at: string | null;
  finished_at: string | null;
  stages: Record<string, StageResult>;
  error: string | null;
  combos: ComboDetail[];
  logs: LogEntry[];
  last_seq: number;
};

export type TriggerResponse = {
  run_id: string;
  status: string;
  already_running: boolean;
};

export type AdminUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

/** Summary row for a persisted brief (from GET /intelligence/briefs). */
export type BriefSummary = {
  company: string;
  role: string;
  level: string;
  specialization: string;
  data_confidence?: string | null;
  generation_status?: string | null;
  query_version?: string | null;
  generated_at?: string | null;
};

/** Full persisted brief doc (passthrough from Mongo) — read fields defensively. */
export type BriefDoc = Record<string, unknown>;

export type Question = {
  slug: string;
  round_type: "dsa" | "system-design" | "lld" | "behavioural";
  title: string;
  url: string;
  sources: string[];
  difficulty: "easy" | "medium" | "hard" | null;
  topic_tags: string[];
  company_tags: string[];
  level_tags: string[];
  enrichment_status: "raw" | "enriched" | "enrich_failed";
  acceptance_rate?: number | null;
  frequency_score?: number | null;
  is_premium?: boolean | null;
  category?: string | null;
  is_machine_coding?: boolean | null;
  estimated_duration_mins?: number | null;
};
export type QuestionsResponse = { questions: Question[]; count: number; returned?: number };
export type QuestionFilters = { roundType?: string; company?: string; difficulty?: string; limit?: number; contentStatus?: string; topic?: string; includeContent?: boolean };

/** Problem bank (docs/question-bank.md): generated from the contract. */
export type QuestionRecord = components["schemas"]["QuestionRecord"];
export type QuestionBankPage = components["schemas"]["QuestionBankPage"];
export type QuestionBankStats = components["schemas"]["QuestionBankStats"];
export type QuestionContentStatus = components["schemas"]["QuestionContentStatus"];
export type QuestionGenerateResponse = components["schemas"]["QuestionGenerateResponse"];
export type DsaContent = components["schemas"]["DsaContent"];
export type SystemDesignContent = components["schemas"]["SystemDesignContent"];
export type LldContent = components["schemas"]["LldContent"];
export type BehaviouralContent = components["schemas"]["BehaviouralContent"];
