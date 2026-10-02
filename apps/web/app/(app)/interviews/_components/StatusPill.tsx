import { StatusDot, type DotState } from "@/components/hud";
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
  live: "text-foreground",
  active: "text-foreground",
  idle: "text-muted-foreground",
  warn: "text-foreground",
  error: "text-destructive",
};

/**
 * A session's state as a HUD status readout: a dot plus the existing mono label ("READY",
 * "LIVE", "PREPARING", "PREP FAILED"). The dot pulses only while the round or its prep is running.
 */
export function StatusPill({ status, className }: { status: SessionStatus; className?: string }) {
  const state = statusDotState(status);
  return (
    <StatusDot state={state} label={statusMeta(status).label} className={cn(LABEL_TONE[state], className)} />
  );
}
