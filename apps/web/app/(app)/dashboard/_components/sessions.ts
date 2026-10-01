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
    .filter((s) => !isFinished(s))
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
