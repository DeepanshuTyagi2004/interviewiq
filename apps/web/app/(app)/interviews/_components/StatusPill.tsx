import { Chip, StatusDot, type ChipDot, type DotState } from "@/components/ds";
import { cn } from "@/lib/utils/cn";
import { statusMeta } from "@/features/interview/presentation";
import type { SessionStatus } from "@/features/interview";

/**
 * The dot for a session status. Only states where something is really running pulse: a live
 * round, and prep in flight. Ready is on but steady, a failed prep is an error, the rest are idle.
 */
export function statusDotState(status: SessionStatus): DotState {
  switch (status) {
    case "LIVE_IN_PROGRESS":
    case "PREP_QUEUED":
      return "live";
    case "PREP_READY":
      return "active";
    case "PREP_FAILED":
      return "error";
    default:
      return "idle";
  }
}

const LABEL_TONE: Record<DotState, string> = {
  live: "text-ink",
  active: "text-ink",
  idle: "text-ink-2",
  warn: "text-ink",
  error: "text-destructive",
};

/**
 * A session's state as a status readout: a dot plus its label ("Ready", "Live",
 * "Preparing", "Prep failed"). The dot pulses only while the round or its prep is running.
 */
export function StatusPill({ status, className }: { status: SessionStatus; className?: string }) {
  const state = statusDotState(status);
  return (
    <StatusDot state={state} label={statusMeta(status).label} className={cn(LABEL_TONE[state], className)} />
  );
}

const CHIP_DOT: Record<DotState, ChipDot> = { live: "live", active: "filled", idle: "hollow", warn: "hollow", error: "filled" };

/** The same state as a chip, for a page hero. Ready and live read as ink; a failed prep as outline with the error colour. */
export function StatusChip({ status, className }: { status: SessionStatus; className?: string }) {
  const state = statusDotState(status);
  return (
    <Chip
      tone={state === "error" ? "outline" : state === "idle" ? "default" : "ink"}
      dot={CHIP_DOT[state]}
      className={cn(state === "error" && "text-destructive", className)}
    >
      {statusMeta(status).label}
    </Chip>
  );
}
