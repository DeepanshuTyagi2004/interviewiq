import type { RoundType } from "../../domain/enums.js";
import type { EngineeringLevel } from "../../domain/engineeringLevels.js";

export type {
  CompanyContextResponse,
  ProfileScoringAssessmentRequest,
  ProfileScoringAssessmentResponse,
  ProfileScoringFeatureAssessment,
} from "./profileAssessment.js";

/**
 * The body POSTed to the ai-service `/blueprints/runs` (and the admin bench). Snake case, as the AI
 * service models it (app/blueprint/models.py). Assembled by BlueprintPrepService; the candidate
 * profile is a minimal projection with no contact details.
 */
export interface BlueprintRunRequest {
  session: {
    session_id: string | null;
    candidate_id: string;
    candidate_label: string | null;
    company: string;
    role: string;
    level: string;
    specialization: string | null;
    round_type: RoundType;
    scheduled_at: string | null;
    loop_id: string | null;
    node_id: string | null;
  };
  job_description: { id: string | null; title: string; description: string | null; tech_stack: string | null };
  round: BlueprintRound | null;
  company_brief: {
    dominant_topics: string[];
    difficulty_calibration: string | null;
    interviewer_style_notes: string | null;
    company_specific_patterns: string | null;
    red_flags: string[];
  } | null;
  candidate_profile: BlueprintCandidateProfile;
  exclusions: string[];
  trigger: "booking" | "reconcile" | "refresh" | "retry" | "bench";
  options: { bypass_blueprint_cache: boolean; bypass_answer_key_cache: boolean; ignore_exclusions: boolean };
  input_hash: string;
  input_parts: Record<string, string>;
}

export interface BlueprintRound {
  type: RoundType;
  name: string | null;
  duration_mins: number | null;
  format: string | null;
  topics: string[];
  problems: string[];
  difficulty: "easy" | "medium" | "hard" | null;
  source: "brief" | "practice";
}

export interface BlueprintCandidateProfile {
  headline: string | null;
  level: EngineeringLevel | null;
  years_experience: number | null;
  skills: string[];
  projects: { name: string; stack: string[]; summary: string | null }[];
  experience: { title: string | null; company: string | null; summary: string | null; start: string | null; end: string | null; internship: boolean }[];
  education: { institution: string | null; degree: string | null; field: string | null; year: string | null }[];
  coding: { total_solved: number | null; easy: number | null; medium: number | null; hard: number | null; top_topics: string[] } | null;
}

/** The body POSTed to the ai-service `/evaluations/runs` (app/evaluation/models.py). Snake case. */
export interface EvaluationRunRequest {
  session_id: string;
  candidate_id: string;
  trigger: "completion" | "reconcile" | "retry" | "admin" | "dispute";
  meta: {
    company: string;
    role: string;
    level: string;
    round_type: string;
    round_minutes: number;
    pass_mark: number;
    code_standard: "runnable" | "near_runnable" | "pseudo_ok";
    company_tier: number | null;
    difficulty: string | null;
    official: boolean;
  };
  candidate_profile: BlueprintCandidateProfile;
  previous_areas: Record<string, number> | null;
  exclusions: string[];
  dispute: { target_type: "question" | "area"; target_id: string; reason: string; report_version: number } | null;
  /** The session's end reason (LiveEndReason); the AI service uses it when the live run's own record has none. */
  ended_reason?: string | null;
}

export interface EvaluationRunStatus {
  run_id: string;
  status: "running" | "completed" | "failed" | "cancelled";
  error?: { code: string; message?: string; transient?: boolean } | null;
  result?: { version: number; outcome: string; score: number | null; verdict: string | null; pass_mark: number } | null;
}
