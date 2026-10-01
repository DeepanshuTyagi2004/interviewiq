import type { MonoPillTone } from "@/components/patterns";
import type { RunStepStatus } from "@/features/observability";

/**
 * How a status reads as a MonoPill: one of the pill tones plus optional extra classes for the two
 * looks the tone set lacks (a hairline outline and a dashed outline). Weight carries meaning in the
 * monochrome palette: ink > soft > outline > dashed > ghost, brand = live/active, alert = failed.
 */
export interface PillLook {
  tone: MonoPillTone;
  className?: string;
}

/** Hairline-outlined pill. An inset ring, so it stays the same size as the filled tones. */
export const OUTLINE_PILL: PillLook = {
  tone: "ghost",
  className: "text-muted-foreground ring-1 ring-inset ring-line-3",
};

/** Dashed outline: present but unverified (e.g. a templated round). Also size-neutral. */
export const DASHED_PILL: PillLook = {
  tone: "ghost",
  className: "text-muted-foreground outline-dashed outline-1 -outline-offset-1 outline-line-4",
};

/** Faint text, no chrome: quiet metadata (a source name, a detected level). */
export const GHOST_PILL: PillLook = { tone: "ghost" };

/** One pipeline step's status pill (résumé / prep run timelines and the agent decision trail). */
export const STEP_PILL: Record<RunStepStatus, PillLook & { label: string }> = {
  pending: { label: "Pending", ...OUTLINE_PILL },
  running: { label: "Running", tone: "brand" },
  ok: { label: "OK", tone: "soft" },
  failed: { label: "Failed", tone: "alert" },
  skipped: { label: "Skipped", ...GHOST_PILL },
};

/** The small status dot beside a step name. Running breathes (put `data-motion` on the dot). */
export const STEP_DOT: Record<RunStepStatus, string> = {
  pending: "bg-line-4",
  running: "bg-brand animate-[iq-breathe_1.4s_ease-in-out_infinite]",
  ok: "bg-foreground",
  failed: "bg-destructive",
  skipped: "bg-line-3",
};

/** "extract_text" → "Extract Text". */
export function prettyStepName(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** 412 → "412ms", 6120 → "6.1s". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
