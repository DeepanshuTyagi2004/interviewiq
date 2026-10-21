/** Report types, derived from the generated OpenAPI schema (never hand-written). */
import type { components } from "@/lib/api-client/generated/schema";

export type RoundReport = components["schemas"]["RoundReport"];
export type RoundOutcome = components["schemas"]["RoundOutcome"];
export type ReadinessLevel = components["schemas"]["ReadinessLevel"];
export type CreateReportDisputeRequest = components["schemas"]["CreateReportDisputeRequest"];
export type ReportDisputeStarted = components["schemas"]["ReportDisputeStarted"];
export type RoundReportEvent = components["schemas"]["RoundReportEvent"];
export type ReportMeta = NonNullable<RoundReport["meta"]>;
export type ReportStatus = RoundReport["status"];
export type ReportQuestion = NonNullable<RoundReport["questions"]>[number];
export type ReportArea = NonNullable<RoundReport["areas"]>[number];
export type ReportDispute = NonNullable<RoundReport["disputes"]>[number];
export type ReportTranscriptTurn = NonNullable<RoundReport["transcript"]>[number];
