import type { InterviewSession } from "@/features/interview";

/** "2026-10-02": a local calendar day, the key that grid cells and sessions meet on. */
export function dayKey(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function sameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export interface CalendarDay {
  date: Date;
  key: string;
  /** False for the leading/trailing days borrowed from the months either side. */
  inMonth: boolean;
}

/** Six Monday-first weeks covering `month`: always 42 days, so the grid's height never jumps. */
export function monthGrid(month: Date): CalendarDay[] {
  const first = startOfMonth(month);
  const lead = (first.getDay() + 6) % 7;
  const start = addDays(first, -lead);
  return Array.from({ length: 42 }, (_, i) => {
    const date = addDays(start, i);
    return { date, key: dayKey(date), inMonth: sameMonth(date, first) };
  });
}

/** Sessions grouped by the local day they're scheduled on, each day in time order. */
export function sessionsByDay(sessions: InterviewSession[]): Map<string, InterviewSession[]> {
  const byDay = new Map<string, InterviewSession[]>();
  const sorted = [...sessions].sort(
    (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
  );
  for (const s of sorted) {
    const key = dayKey(new Date(s.scheduledAt));
    const day = byDay.get(key);
    if (day) day.push(s);
    else byDay.set(key, [s]);
  }
  return byDay;
}

/** How many sessions fall inside `month`. */
export function countInMonth(byDay: Map<string, InterviewSession[]>, month: Date): number {
  const prefix = dayKey(startOfMonth(month)).slice(0, 8);
  let n = 0;
  for (const [key, list] of byDay) if (key.startsWith(prefix)) n += list.length;
  return n;
}
