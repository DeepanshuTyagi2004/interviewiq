/** JD library types. Top-level JD fields are camelCase (backend DTOs); `interviewProcess`
 *  is the brief's round-by-round process from the AI service (snake_case) — the public fields of
 *  `final_experience` for current briefs, or the legacy `consolidated_process`. */
import type { components } from "@/lib/api-client/generated/schema";

type JobDescriptionDetail = components["schemas"]["JobDescriptionDetail"];
type PublishedRound = NonNullable<NonNullable<JobDescriptionDetail["interviewProcess"]>["rounds"]>[number];

export type DataAvailability = "rich" | "available" | "limited" | "none";

export type JdSummary = {
  id: string;
  /** Explicitly simulated practice, absent on older responses. */
  practiceTemplate?: JobDescriptionDetail["practiceTemplate"];
  company: string;
  companyName: string;
  role: string;
  level: JobDescriptionDetail["level"];
  legacyLevel?: string | null;
  title: string;
  specialization: string | null;
  /** Technologies the role uses; absent on older API responses. */
  techStack?: string[];
  yoeMin?: number | null;
  yoeMax?: number | null;
  ctcMinLpa?: number | null;
  ctcMaxLpa?: number | null;
  dataConfidence: string | null;
  dataAvailability: DataAvailability;
};

export type ConsolidatedRound = Pick<PublishedRound, "id" | "name" | "duration_minutes" | "problems" | "source_urls"> & {
  provenance?: string | null;
  round_number?: number | null;
  type?: string | null;
  /** `info` = not an interview (online test, take-home…): shown, never booked or counted. */
  kind?: string | null;
  consistency?: string | null;
  format?: string | null;
  dominant_topics?: string[];
  difficulty?: string | null;
  /** The staged pipeline's `final_experience` round shape names its topics `topics`, and adds
   *  how many on-level sources attest the round. Optional: present only on that shape. */
  topics?: string[];
  support_count?: number | null;
  source_count_total?: number | null;
};

export type InterviewProcess = {
  typical_round_count?: number | null;
  rounds?: ConsolidatedRound[];
  dominant_topics?: string[];
  difficulty_calibration?: string | null;
  interviewer_style_notes?: string | null;
  red_flags?: string[];
  company_specific_patterns?: string | null;
  data_confidence?: string | null;
};

/** Top-level DTO is generated; retain the typed legacy brief fields in its open process payload. */
export type JdDetail = Omit<JobDescriptionDetail, "interviewProcess"> & {
  interviewProcess: InterviewProcess | null;
};

export type JobCompany = {
  id: string;
  name: string;
  slug: string;
  tier: number | null;
  logoUrl: string | null;
  headquarterLocation: string | null;
  companySize: string | null;
};

/** JD fit: how closely the user's profile matches one JD (never a hiring decision). Generated from the contract. */
export type JdFitList = components["schemas"]["JdFitList"];
export type JdFitResult = components["schemas"]["JdFitResult"];
export type JdFitBreakdown = components["schemas"]["JdFitBreakdown"];
export type JdFitPart = components["schemas"]["JdFitPart"];
export type JdFitEvidence = components["schemas"]["JdFitEvidence"];
export type JdFitLevelGap = components["schemas"]["JdFitLevelGap"];
