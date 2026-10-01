import type { EducationDto, ExperienceDto, ProjectDto, ResumeLinksDto } from "../../domain/candidateProfile.js";
import type { RoundType } from "../../domain/enums.js";

/**
 * The body POSTed to the ai-service `/interview-plans*` endpoints. Mirrors
 * `GenerateInterviewPlanRequest` in packages/contracts/openapi.yaml (camelCase keys, explicit
 * nulls, roundType as its wire value) — the AI service caches plans on a hash of this body.
 */
export interface GenerateInterviewPlanRequest {
  session: PlanSessionContext;
  jobDescription: PlanJobDescription;
  candidateProfile: PlanCandidateProfile;
}

export interface PlanSessionContext {
  sessionId: string;
  candidateId: string;
  company: string;
  role: string;
  level: string;
  specialization: string | null;
  roundType: RoundType;
}

export interface PlanJobDescription {
  id: string;
  title: string;
  description: string | null;
  techStack: string | null;
}

export interface PlanCandidateProfile {
  fullName: string | null;
  headline: string | null;
  targetRole: string | null;
  education: EducationDto[];
  experience: ExperienceDto[];
  projects: ProjectDto[];
  skills: string[];
  achievements: string[];
  links: ResumeLinksDto;
  /** Null only on the admin bench when no candidate is chosen. */
  codingProfile: PlanCodingProfile | null;
}

/**
 * Curated GitHub + LeetCode signals (compact, low-churn sub-objects of the fragments — the volatile
 * contribution grid is dropped so it doesn't invalidate the plan cache). Null when not connected.
 */
export interface PlanCodingProfile {
  github: Record<string, unknown> | null;
  leetcode: Record<string, unknown> | null;
}
