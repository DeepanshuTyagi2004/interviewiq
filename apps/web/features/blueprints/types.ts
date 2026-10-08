/** Blueprint diagnostics types — derived from the generated OpenAPI schema (never hand-written). */
import type { components, operations } from "@/lib/api-client/generated/schema";

type S = components["schemas"];

export type Blueprint = S["Blueprint"];
export type BlueprintSlot = S["BlueprintSlot"];
export type BlueprintBranch = S["BlueprintBranch"];
export type BlueprintRunSummary = S["BlueprintRunSummary"];
export type BlueprintRunList = S["BlueprintRunList"];
export type BlueprintRunDetail = S["BlueprintRunDetail"];
export type BlueprintStage = S["BlueprintStage"];
export type BlueprintLlmCall = S["BlueprintLlmCall"];
export type BlueprintRunStatus = S["BlueprintRunStatus"];
export type BlueprintTrigger = S["BlueprintTrigger"];
export type BlueprintStageId = S["BlueprintStageId"];
export type BlueprintRunStarted = S["BlueprintRunStarted"];
export type BlueprintVersionList = S["BlueprintVersionList"];
export type BlueprintDiff = S["BlueprintDiff"];
export type AnswerKeyList = S["AnswerKeyList"];
export type BlueprintBenchCandidate = S["BlueprintBenchCandidate"];
export type BlueprintBenchRequest = S["BlueprintBenchRequest"];
export type BlueprintRunFilters = NonNullable<operations["listBlueprintRuns"]["parameters"]["query"]>;

/** One candidate row of a slot's selection trace (stage `selection` → detail.slots[].candidates). */
export interface SelectionCandidateRow {
  slug: string;
  title: string;
  difficulty: string | null;
  category: string | null;
  primary: string;
  score: number;
  breakdown: Record<string, number>;
  outcome: "picked" | "not_drawn" | "used_elsewhere" | "out_of_difficulty" | "lost_to_diversity" | "excluded_seen" | "swapped_out";
  reason: string;
}

/** One slot of the selection trace. */
export interface SelectionSlotTrace {
  slot_id: string;
  kind: "core" | "reserve";
  purpose: string;
  picked: string | null;
  relaxations: string[];
  swaps: { slug: string; reason: string }[];
  candidates: SelectionCandidateRow[];
}

/** One invariant check (stage `validate` → detail.checks). */
export interface InvariantCheck {
  check: string;
  passed: boolean;
  detail: string;
}
