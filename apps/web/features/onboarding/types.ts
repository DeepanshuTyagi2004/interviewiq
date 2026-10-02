/**
 * Mirrors the backend candidate-profile DTOs (camelCase). Every string field is nullable because
 * the resume parse may not find it and the user may leave it blank.
 */

export interface EducationDto {
  institution: string | null;
  degree: string | null;
  field: string | null;
  startYear: string | null;
  endYear: string | null;
  grade: string | null;
}

export interface ExperienceDto {
  company: string | null;
  title: string | null;
  startDate: string | null;
  endDate: string | null;
  location: string | null;
  bullets: string[];
}

export interface ProjectDto {
  name: string | null;
  description: string | null;
  tech: string[];
  bullets: string[];
  link: string | null;
}

export interface ResumeLinksDto {
  github: string | null;
  leetcode: string | null;
  linkedin: string | null;
}

/** GET/PUT response, and the unsaved draft returned by resume parsing. */
export interface CandidateProfileResponse {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  headline: string | null;
  targetRole: string | null;
  /** The JD picked on onboarding's Target step; `targetRole` holds its label. */
  targetJdId: string | null;
  education: EducationDto[];
  experience: ExperienceDto[];
  projects: ProjectDto[];
  skills: string[];
  achievements: string[];
  detectedLinks: ResumeLinksDto;
  resumeFilename: string | null;
  resumeParsedAt: string | null;
  onboardingComplete: boolean;
}

/** Status of an async resume-parse run (fire-and-poll). */
export interface ResumeParseRunResponse {
  status: "running" | "completed" | "failed";
  profile: CandidateProfileResponse | null;
  error: string | null;
}

/** PUT payload. `complete=true` finishes onboarding (flips User.onboardingComplete). */
export interface CandidateProfileRequest {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  headline: string | null;
  targetRole: string | null;
  targetJdId: string | null;
  education: EducationDto[];
  experience: ExperienceDto[];
  projects: ProjectDto[];
  skills: string[];
  achievements: string[];
  detectedLinks: ResumeLinksDto;
  resumeFilename: string | null;
  complete: boolean;
}
