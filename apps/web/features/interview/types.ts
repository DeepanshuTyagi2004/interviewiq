/**
 * Interview booking types — derived from the generated OpenAPI schema (the api↔web source of
 * truth). Never hand-write these to mirror the Spring DTOs; regenerate with `npm run generate:types`.
 */
import type { components } from "@/lib/api-client/generated/schema";

export type InterviewSession = components["schemas"]["InterviewSession"];
export type SessionStatus = components["schemas"]["SessionStatus"];
export type RoundType = components["schemas"]["RoundType"];
export type CreateInterviewSessionRequest = components["schemas"]["CreateInterviewSessionRequest"];
export type InterviewSessionListResponse = components["schemas"]["InterviewSessionListResponse"];
export type GoLiveResponse = components["schemas"]["GoLiveResponse"];
export type CandidateLiveEndResult = components["schemas"]["CandidateLiveEndResult"];
export type SessionPrep = components["schemas"]["SessionPrep"];
export type PrepStep = components["schemas"]["PrepStep"];
export type SessionBriefing = components["schemas"]["SessionBriefing"];
