import type { components } from "@/lib/api-client/generated/schema";

/** Candidate-profile DTOs follow the generated wire contract, including nullable parsed arrays. */
export type EducationDto = components["schemas"]["CandidateProfileEducation"];
export type ExperienceDto = components["schemas"]["CandidateProfileExperience"];
export type ProjectDto = components["schemas"]["CandidateProfileProject"];
export type ResumeLinksDto = components["schemas"]["CandidateProfileLinks"];
export type CandidateProfileResponse = components["schemas"]["CandidateProfileResponse"];
export type CandidateProfileRequest = components["schemas"]["CandidateProfileRequest"];
export type ResumeParseRunResponse = components["schemas"]["ResumeParseRunResponse"];
