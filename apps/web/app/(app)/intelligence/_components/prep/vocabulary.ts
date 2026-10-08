import { DASHED_PILL, GHOST_PILL, OUTLINE_PILL, type PillLook } from "@/components/observability/status";
import type { BlueprintRunSummary, BlueprintStage, BlueprintStageId, SelectionCandidateRow } from "@/features/blueprints";
import type { RunStepStatus } from "@/features/observability";

/**
 * Display vocabularies for the Interview prep diagnostics tab (spec §6, §7.8, §8.1). These are UI
 * labels and groupings for values the API already sends, not DTOs.
 */

export type RoundType = BlueprintRunSummary["round_type"];

export const ROUND_TYPES: readonly RoundType[] = ["dsa", "system-design", "lld", "behavioural", "hiring-manager"];

const ROUND_LABEL: Record<string, string> = {
  "dsa": "DSA",
  "online-assessment": "Online assessment",
  "system-design": "System design",
  "lld": "LLD",
  "behavioural": "Behavioural",
  "hiring-manager": "Hiring manager",
};

export function roundLabel(roundType: string | null | undefined): string {
  if (!roundType) return "—";
  return ROUND_LABEL[roundType] ?? roundType;
}

/** The eight run stages, in pipeline order (spec §6). */
export const STAGE_ORDER: readonly BlueprintStageId[] = [
  "context", "selection", "answer_keys", "persona", "personalization", "playbooks", "policies", "validate",
];

/** Fallback stage names, used only when a stage record carries no label of its own. */
export const STAGE_LABEL: Record<BlueprintStageId, string> = {
  context: "Context",
  selection: "Problem selection",
  answer_keys: "Answer keys",
  persona: "Persona and arc",
  personalization: "Personalization",
  playbooks: "Playbooks",
  policies: "Policies",
  validate: "Assemble and validate",
};

/** A stage's status in the shared step-pill vocabulary (`done` reads as `ok`). */
export function stepStatus(status: BlueprintStage["status"]): RunStepStatus {
  return status === "done" ? "ok" : status;
}

/* ------------------------------------------------------------------ conditions (spec §8.1) */

export type ConditionFamily = "dsa" | "system-design" | "lld" | "behavioural";

export const COMMON_CONDITIONS: readonly string[] = [
  "stuck", "long_silence", "asks_clarification", "asks_hint", "asks_for_answer", "off_topic", "seen_before", "over_time", "nervous",
];

export const FAMILY_CONDITIONS: Record<ConditionFamily, readonly string[]> = {
  "dsa": ["wrong_approach", "partially_correct", "correct_suboptimal", "correct_optimal", "bug_in_code"],
  "lld": ["wrong_approach", "partially_correct", "correct_suboptimal", "correct_optimal", "bug_in_code"],
  "system-design": ["skips_requirements", "shallow_design", "ignores_scale", "strong_design"],
  "behavioural": ["vague_answer", "no_result", "only_we", "inconsistent", "strong_story"],
};

export const FAMILY_LABEL: Record<ConditionFamily, string> = {
  "dsa": "DSA",
  "lld": "LLD",
  "system-design": "System design",
  "behavioural": "Behavioural and HR",
};

/** The condition family a round type belongs to (online assessment → DSA, hiring manager → behavioural). */
export function familyOf(roundType: string | null | undefined): ConditionFamily {
  switch (roundType) {
    case "system-design":
      return "system-design";
    case "lld":
      return "lld";
    case "behavioural":
    case "hiring-manager":
      return "behavioural";
    default:
      return "dsa";
  }
}

/* ------------------------------------------------------------------ selection outcomes (spec §7.8) */

export type SelectionOutcome = SelectionCandidateRow["outcome"];

export const OUTCOMES: readonly SelectionOutcome[] = [
  "picked", "not_drawn", "used_elsewhere", "out_of_difficulty", "lost_to_diversity", "excluded_seen", "swapped_out",
];

/** Weight carries meaning in the monochrome palette: picked is ink, a failed key's swap is alert. */
export const OUTCOME_META: Record<SelectionOutcome, { label: string; look: PillLook }> = {
  picked: { label: "picked", look: { tone: "ink" } },
  not_drawn: { label: "not drawn", look: OUTLINE_PILL },
  used_elsewhere: { label: "used elsewhere", look: GHOST_PILL },
  out_of_difficulty: { label: "out of difficulty", look: DASHED_PILL },
  lost_to_diversity: { label: "lost to diversity", look: DASHED_PILL },
  excluded_seen: { label: "seen before", look: GHOST_PILL },
  swapped_out: { label: "swapped out", look: { tone: "alert" } },
};

/** The score breakdown columns, in the spec's order (§7.4). */
export const BREAKDOWN_COLUMNS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "named", label: "Named" },
  { key: "company", label: "Company" },
  { key: "topic", label: "Topic" },
  { key: "difficulty", label: "Difficulty" },
  { key: "level", label: "Level" },
  { key: "popularity", label: "Popularity" },
];

/** A policy request's decision, as a pill look. */
export const DECISION_LOOK: Record<string, PillLook> = {
  comply: { tone: "soft" },
  partial: OUTLINE_PILL,
  decline: DASHED_PILL,
};
