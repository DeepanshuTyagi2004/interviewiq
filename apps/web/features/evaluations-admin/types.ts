/** Evaluation diagnostics types (admin) — derived from the generated OpenAPI schema (never hand-written). */
import type { components, operations } from "@/lib/api-client/generated/schema";

type S = components["schemas"];

export type EvaluationRunSummary = S["EvaluationRunSummary"];
export type EvaluationRunList = S["EvaluationRunList"];
export type EvaluationRunDetail = S["EvaluationRunDetail"];
export type EvaluationRunStatus = EvaluationRunSummary["status"];
export type EvaluationRunError = S["EvaluationRunError"];
export type PartGrade = S["EvaluationPartGrade"];
export type Disagreement = S["EvaluationDisagreement"];
export type EvaluationRaw = S["EvaluationRaw"];
export type EvaluationArithmetic = S["EvaluationArithmetic"];
export type EvaluationRerunStarted = S["EvaluationRerunStarted"];
export type EvaluationFilters = NonNullable<operations["listEvaluationRuns"]["parameters"]["query"]>;
