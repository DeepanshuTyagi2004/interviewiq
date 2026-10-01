/** JD library types. Top-level JD fields are camelCase (backend DTOs); `interviewProcess`
 *  is the brief's round-by-round process from the AI service (snake_case) — the public fields of
 *  `final_experience` for current briefs, or the legacy `consolidated_process`. */

export type DataAvailability = "rich" | "available" | "limited" | "none";

export type JdSummary = {
  id: string;
  company: string;
  companyName: string;
  role: string;
  level: string;
  title: string;
  specialization: string | null;
  dataConfidence: string | null;
  dataAvailability: DataAvailability;
};

export type ConsolidatedRound = {
  round_number?: number | null;
  type?: string | null;
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

export type JdDetail = {
  id: string;
  company: string;
  companyName: string;
  role: string;
  level: string;
  title: string;
  specialization: string | null;
  description: string | null;
  techStack: string[];
  sourceUrl: string | null;
  dataConfidence: string | null;
  dataAvailability: DataAvailability;
  interviewProcess: InterviewProcess | null;
  sources: string[];
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
