/**
 * Pure display helpers for interview sessions, shared by the interviews list, the session detail,
 * the live room and the debrief. No data fetching and no invented values: everything here is a
 * formatting of what the API returned.
 */
import type { MonoPillTone } from "@/components/patterns";
import { ROUND_OPTIONS, SESSION_STATUS_META } from "@/lib/constants/interview";
import { ROUTES } from "@/lib/constants/shared";
import type { InterviewSession, RoundType, SessionStatus } from "./types";

const ROUND_LABEL = new Map<string, string>(ROUND_OPTIONS.map((r) => [r.value, r.label]));
const ROUND_VALUES = new Set<string>(ROUND_OPTIONS.map((r) => r.value));

/** "system-design" → "System Design"; unknown values pass through unchanged. */
export function roundLabel(roundType: string): string {
  return ROUND_LABEL.get(roundType) ?? roundType;
}

export function isRoundType(value: unknown): value is RoundType {
  return typeof value === "string" && ROUND_VALUES.has(value);
}

const LEVEL_LABEL: Record<string, string> = { fresher: "Fresher", sde1: "SDE I", sde2: "SDE II", sde3: "SDE III" };

/** "sde1" → "SDE I"; anything else (already human-readable) passes through. */
export function levelLabel(level: string): string {
  return LEVEL_LABEL[level.toLowerCase()] ?? level;
}

/** The human company name when the API knows it, otherwise the slug. */
export function companyLabel(session: Pick<InterviewSession, "company" | "companyName">): string {
  return session.companyName ?? session.company;
}

export interface StatusMeta {
  label: string;
  tone: MonoPillTone;
  /** Work is in flight (prep running): the pill shows a spinner. */
  pending: boolean;
  /** Happening right now: the pill shows a breathing brand dot. */
  live?: boolean;
}

/**
 * How each session status reads on a mono pill. The four prep states keep the labels from
 * `SESSION_STATUS_META`; the live/terminal states (which that map doesn't cover) are added here.
 */
export const STATUS_META: Record<SessionStatus, StatusMeta> = {
  SCHEDULED: { label: SESSION_STATUS_META.SCHEDULED?.label ?? "Scheduled", tone: "soft", pending: false },
  PREP_QUEUED: { label: SESSION_STATUS_META.PREP_QUEUED?.label ?? "Preparing", tone: "soft", pending: true },
  PREP_READY: { label: SESSION_STATUS_META.PREP_READY?.label ?? "Ready", tone: "ink", pending: false },
  PREP_FAILED: { label: SESSION_STATUS_META.PREP_FAILED?.label ?? "Prep failed", tone: "alert", pending: false },
  LIVE_IN_PROGRESS: { label: "Live", tone: "ink", pending: false, live: true },
  COMPLETED: { label: "Done", tone: "soft", pending: false },
  ABORTED_TECHNICAL: { label: "Interrupted", tone: "ghost", pending: false },
  CANCELLED: { label: "Cancelled", tone: "ghost", pending: false },
};

export function statusMeta(status: string): StatusMeta {
  return STATUS_META[status as SessionStatus] ?? STATUS_META.SCHEDULED;
}

/** The round is over (debrief territory), whether it finished or dropped. */
export function isFinished(session: Pick<InterviewSession, "status">): boolean {
  return session.status === "COMPLETED" || session.status === "ABORTED_TECHNICAL";
}

/** The candidate can enter the room now. */
export function isJoinable(session: Pick<InterviewSession, "status">): boolean {
  return session.status === "PREP_READY" || session.status === "LIVE_IN_PROGRESS";
}

const byTime = (s: Pick<InterviewSession, "scheduledAt">) => new Date(s.scheduledAt).getTime();

/** Upcoming sessions soonest first; finished ones most recent first. */
export function partitionSessions<T extends Pick<InterviewSession, "status" | "scheduledAt">>(
  sessions: T[],
): { upcoming: T[]; past: T[] } {
  const closed = (s: Pick<InterviewSession, "status">) => isFinished(s) || s.status === "CANCELLED";
  const upcoming = sessions.filter((s) => !closed(s)).sort((a, b) => byTime(a) - byTime(b));
  const past = sessions.filter(closed).sort((a, b) => byTime(b) - byTime(a));
  return { upcoming, past };
}

/** "Thu, 1 Oct · 10:00" in the viewer's locale. */
export function formatSlot(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${day} · ${time}`;
}

/** Link to the booking form with a JD (and optionally a round) pre-selected. */
export function bookingHref(prefill: { jd?: string; round?: string } = {}): string {
  const params = new URLSearchParams();
  if (prefill.jd) params.set("jd", prefill.jd);
  if (prefill.round) params.set("round", prefill.round);
  const qs = params.toString();
  return qs ? `${ROUTES.interviews}?${qs}` : ROUTES.interviews;
}

export interface BookingPrefill {
  jobDescriptionId?: string;
  roundType?: RoundType;
}

// JD ids are UUIDs from the API; this only guards against junk (the form still checks the id
// against the loaded JD list before using it).
const JD_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Reads `?jd=<jdId>&round=<roundType>` (the roadmap's "book this round" link). Each value is kept
 * only when well-formed; anything else is dropped silently so a bad link just opens a blank form.
 */
export function parseBookingPrefill(params: Record<string, string | string[] | undefined>): BookingPrefill {
  const jd = first(params.jd)?.trim();
  const round = first(params.round)?.trim().toLowerCase();
  return {
    ...(jd && JD_ID_RE.test(jd) ? { jobDescriptionId: jd } : {}),
    ...(isRoundType(round) ? { roundType: round } : {}),
  };
}

export type StepState = "done" | "current" | "upcoming" | "failed";

export interface SessionStep {
  key: "booked" | "prep" | "interview" | "debrief";
  label: string;
  state: StepState;
  note: string;
}

/**
 * A session's lifecycle as four steps (booked → interviewer prepared → interview → debrief), read
 * straight off its status. Describes where the session is; it says nothing about scores or gating.
 */
export function sessionSteps(status: SessionStatus): SessionStep[] {
  const prep: Pick<SessionStep, "state" | "note"> =
    status === "SCHEDULED"
      ? { state: "upcoming", note: "Starts ahead of your slot" }
      : status === "PREP_QUEUED"
        ? { state: "current", note: "Preparing now" }
        : status === "PREP_FAILED"
          ? { state: "failed", note: "Prep failed. Retry to try again" }
          : { state: "done", note: "Interviewer ready" };

  const interview: Pick<SessionStep, "state" | "note"> =
    status === "PREP_READY"
      ? { state: "current", note: "Ready to join" }
      : status === "LIVE_IN_PROGRESS"
        ? { state: "current", note: "In progress" }
        : status === "COMPLETED"
          ? { state: "done", note: "Finished" }
          : status === "ABORTED_TECHNICAL"
            ? { state: "failed", note: "Ended early by a technical problem" }
            : { state: "upcoming", note: "Opens once prep is ready" };

  const finished = status === "COMPLETED" || status === "ABORTED_TECHNICAL";

  return [
    { key: "booked", label: "Booked", state: "done", note: "Slot reserved" },
    { key: "prep", label: "Interviewer prepared", ...prep },
    { key: "interview", label: "Interview", ...interview },
    {
      key: "debrief",
      label: "Debrief",
      ...(finished
        ? { state: "current" as const, note: "Scoring isn't live yet" }
        : { state: "upcoming" as const, note: "After the round" }),
    },
  ];
}
