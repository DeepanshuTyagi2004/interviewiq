import type { DotState } from "@/components/hud";
import {
  DASHED_PILL,
  GHOST_PILL,
  OUTLINE_PILL,
  type PillLook,
} from "@/components/observability/status";
import type { AgentSessionStatus } from "@/features/agent-diagnostics";
import type { Question, RunStatus } from "@/features/intelligence";

/**
 * Status → MonoPill looks for the intelligence console. The palette is monochrome, so weight
 * carries meaning: ink (strongest) > soft > outline > dashed > ghost; brand = live, alert = failed.
 */

/**
 * The whole ingestion run, as a HUD status dot. Only a run that is really in flight is `live` (the
 * one state that pulses); a finished run is a steady `active`, a stopped or never-run one `idle`.
 */
export const RUN_STATUS_DOT: Record<RunStatus, DotState> = {
  running: "live",
  completed: "active",
  failed: "error",
  cancelled: "idle",
  idle: "idle",
};

/**
 * An agent diagnostics session, as a HUD status dot. Both `running` and `awaiting_input` are a live
 * session (the agent is mid-run, or waiting on the admin's next turn), so both pulse.
 */
export const SESSION_DOT: Record<AgentSessionStatus, DotState> = {
  running: "live",
  awaiting_input: "live",
  completed: "active",
  failed: "error",
  abandoned: "idle",
  aborted: "idle",
};

/** One JD's brief-generation status (per combination / per stored brief). */
export const BRIEF_STATUS_PILL: Record<string, PillLook> = {
  success: { tone: "soft" },
  insufficient_data: OUTLINE_PILL,
  failed: { tone: "alert" },
  running: { tone: "brand" },
  skipped: GHOST_PILL,
};

/** How much real data backs a brief. */
export const CONFIDENCE_PILL: Record<string, PillLook> = {
  high: { tone: "ink" },
  medium: { tone: "soft" },
  low: OUTLINE_PILL,
};

/** Why each collected source was or wasn't used in the final experience. */
export const FUNNEL_STATUS: Record<string, { label: string; look: PillLook }> = {
  cited: { label: "cited", look: { tone: "ink" } },
  extracted_unused: { label: "not used", look: { tone: "soft" } },
  off_level_excluded: { label: "off-level (excluded)", look: OUTLINE_PILL },
  off_geo_excluded: { label: "off-geo (excluded)", look: OUTLINE_PILL },
  no_rounds: { label: "no rounds found", look: GHOST_PILL },
  no_process: { label: "no process described", look: GHOST_PILL },
  extract_failed: { label: "extract failed", look: { tone: "alert" } },
};
export const FUNNEL_ORDER = [
  "cited",
  "extracted_unused",
  "off_level_excluded",
  "off_geo_excluded",
  "no_rounds",
  "no_process",
  "extract_failed",
];

/** How a source's detected seniority relates to the JD level (exact/adjacent = on-level). */
export const MATCH_TIER_META: Record<string, { label: string; look: PillLook }> = {
  exact: { label: "exact level", look: { tone: "soft" } },
  adjacent: { label: "adjacent level", look: OUTLINE_PILL },
  unknown: { label: "level unknown", look: GHOST_PILL },
  off: { label: "off-level", look: DASHED_PILL },
};

/** How a round is grounded, in descending trust:
 *  evidence_backed > process_guide > inferred_from_similar > template. */
export const PROVENANCE_META: Record<string, { label: string; look: PillLook }> = {
  evidence_backed: { label: "evidence-backed", look: { tone: "ink" } },
  process_guide: { label: "process guide", look: { tone: "soft" } },
  inferred_from_similar: { label: "inferred", look: OUTLINE_PILL },
  template: { label: "template", look: DASHED_PILL },
};

/** Question difficulty: heavier = harder. */
export const DIFFICULTY_PILL: Record<NonNullable<Question["difficulty"]>, PillLook> = {
  easy: OUTLINE_PILL,
  medium: { tone: "soft" },
  hard: { tone: "ink" },
};

/** Look up a key in a status map, falling back for unknown / missing values. */
export function lookFor<T>(map: Record<string, T>, key: string | null | undefined, fallback: T): T {
  return (key != null && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined) ?? fallback;
}
