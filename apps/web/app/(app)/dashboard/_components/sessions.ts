import type { InterviewSession, SessionStatus } from "@/features/interview";

/** Statuses that mean the session is over and no longer "upcoming". */
const FINISHED: ReadonlySet<SessionStatus> = new Set(["COMPLETED", "ABORTED_TECHNICAL"]);

export function isFinished(session: Pick<InterviewSession, "status">): boolean {
  return FINISHED.has(session.status);
}

/** Sessions that are over, most recent first. */
export function recentSessions(sessions: InterviewSession[], limit = 4): InterviewSession[] {
  return sessions
    .filter(isFinished)
    .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime())
    .slice(0, limit);
}

/** Sessions still ahead of the candidate, soonest first. */
export function upcomingSessions(sessions: InterviewSession[], limit = 4): InterviewSession[] {
  return sessions
    .filter((s) => !isFinished(s) && s.status !== "CANCELLED")
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
    .slice(0, limit);
}

export type PillTone = "ink" | "soft" | "muted" | "alert";

/**
 * The mono status pill shown on a session row, in the design's vocabulary: a date ("OCT 04")
 * while it's simply scheduled, otherwise the prep/live state.
 */
export function sessionPill(session: Pick<InterviewSession, "status" | "scheduledAt">): {
  label: string;
  tone: PillTone;
} {
  switch (session.status) {
    case "PREP_READY":
      return { label: "READY", tone: "ink" };
    case "LIVE_IN_PROGRESS":
      return { label: "LIVE", tone: "ink" };
    case "PREP_QUEUED":
      return { label: "PREPARING", tone: "soft" };
    case "PREP_FAILED":
      return { label: "PREP FAILED", tone: "alert" };
    case "COMPLETED":
      return { label: "DONE", tone: "muted" };
    case "ABORTED_TECHNICAL":
      return { label: "INTERRUPTED", tone: "muted" };
    case "CANCELLED":
      return { label: "CANCELLED", tone: "muted" };
    default:
      return { label: shortDate(session.scheduledAt), tone: "soft" };
  }
}

/** Where the session's primary action goes: the room once it's joinable, otherwise the list. */
export function sessionHref(session: Pick<InterviewSession, "id" | "status">): string {
  return session.status === "PREP_READY" || session.status === "LIVE_IN_PROGRESS"
    ? `/interviews/${session.id}/live`
    : "/interviews";
}

/** "Thu, 1 Oct · 10:00" — the slot in the candidate's locale. */
export function formatSlot(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${day} · ${time}`;
}

/** "OCT 04" — month + zero-padded day, upper-cased. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  const month = d.toLocaleString("en-US", { month: "short" }).toUpperCase();
  return `${month} ${String(d.getDate()).padStart(2, "0")}`;
}

/** "12 Oct": day and short month, as the results table and chips show a date. */
export function dayMonth(iso: string | Date): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Whole calendar days from `now`'s day to the slot's day (negative once the day has passed). */
function daysUntil(iso: string, now: Date): number {
  const ms = startOfDay(new Date(iso)).getTime() - startOfDay(now).getTime();
  return Math.round(ms / 86_400_000);
}

/** How far off the slot is, for the "Up next" chip: "Today", "Tomorrow", "in 4 days", or the date past two weeks. */
export function whenLabel(iso: string, now: Date = new Date()): string {
  const n = daysUntil(iso, now);
  if (n <= 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n <= 14) return `in ${n} days`;
  return dayMonth(iso);
}

/** Sessions booked from `now`'s day for the next `days` days (cancelled ones never count), soonest first. */
export function weekSessions(sessions: InterviewSession[], now: Date = new Date(), days = 7): InterviewSession[] {
  return sessions
    .filter((s) => {
      if (s.status === "CANCELLED") return false;
      const n = daysUntil(s.scheduledAt, now);
      return n >= 0 && n < days;
    })
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
}

export interface OutcomeChipSpec {
  label: string;
  /** Passed fills the dot; everything else is hollow. */
  tone: "passed" | "retake" | "neutral";
}

/**
 * The outcome chip on a result row. A below-pass round shows the retake date while the cooldown
 * is still running, and "Retake now" once it has passed or the API sent none.
 */
export function outcomeChip(
  session: Pick<InterviewSession, "status" | "outcome" | "retakeAfter" | "evaluationStatus">,
  now: Date = new Date(),
): OutcomeChipSpec {
  switch (session.outcome) {
    case "passed":
      return { label: "Passed", tone: "passed" };
    case "below_pass":
    case "auto_fail": {
      const after = session.retakeAfter ? new Date(session.retakeAfter) : null;
      return after && after.getTime() > now.getTime()
        ? { label: `Retake ${dayMonth(after)}`, tone: "retake" }
        : { label: "Retake now", tone: "retake" };
    }
    case "unscorable":
      return { label: "Not scored", tone: "neutral" };
    default:
      if (session.status === "ABORTED_TECHNICAL") return { label: "Interrupted", tone: "neutral" };
      if (session.evaluationStatus === "evaluating") return { label: "Grading", tone: "neutral" };
      return { label: "Not scored", tone: "neutral" };
  }
}

/** "7.8" for a graded round, otherwise null. */
export function scoreText(score: number | null | undefined): string | null {
  return typeof score === "number" && Number.isFinite(score) ? score.toFixed(1) : null;
}
