import type { InterviewSession } from "@/features/interview";

/** Bookable hourly slots (local time), same window as the ad-hoc booking form. */
export const SLOT_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
/** Two interviews may not start within this many minutes of each other (mirrors the API). */
export const SLOT_MINUTES = 60;

export const startOfToday = (): Date => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

export const addDays = (d: Date, n: number): Date => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

export const slotAt = (day: Date, hour: number): Date => {
  const s = new Date(day);
  s.setHours(hour, 0, 0, 0);
  return s;
};

export const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

/** Sessions that still hold a slot: not cancelled and not interrupted. */
export const holdsSlot = (s: Pick<InterviewSession, "status">) => s.status !== "CANCELLED" && s.status !== "ABORTED_TECHNICAL";

/** True if the candidate already has an interview whose start is within SLOT_MINUTES of `slot`. */
export function isSlotTaken(slot: Date, sessions: Pick<InterviewSession, "id" | "status" | "scheduledAt">[], ignoreId?: string): boolean {
  const ms = SLOT_MINUTES * 60_000;
  return sessions.some((s) => {
    if (!holdsSlot(s) || s.id === ignoreId) return false;
    const t = new Date(s.scheduledAt).getTime();
    return t > slot.getTime() - ms && t < slot.getTime() + ms;
  });
}

export const isPast = (slot: Date) => slot.getTime() <= Date.now();

/** "Thu 1 Oct · 10:00" */
export function slotText(d: Date): string {
  const day = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  return `${day} · ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}
