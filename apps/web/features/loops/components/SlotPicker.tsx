"use client";

import { cn } from "@/lib/utils/cn";
import type { InterviewSession } from "@/features/interview";
import { addDays, hourLabel, isPast, isSlotTaken, slotAt, SLOT_HOURS, startOfToday } from "../slots";

const DAYS = 14;

const chip = (selected: boolean) =>
  cn(
    "rounded-full font-sans transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed disabled:opacity-40",
    selected ? "bg-ink text-background" : "bg-surface-2 text-foreground shadow-ring enabled:hover:bg-stone",
  );

export interface SlotPickerProps {
  day: Date | null;
  hour: number | null;
  onChange: (day: Date | null, hour: number | null) => void;
  sessions: Pick<InterviewSession, "id" | "status" | "scheduledAt">[];
  /** The session being rescheduled: its own slot is not a clash. */
  ignoreSessionId?: string;
}

/** Day + hour chips. Slots in the past, or within an hour of another interview of yours, are disabled. */
export function SlotPicker({ day, hour, onChange, sessions, ignoreSessionId }: SlotPickerProps) {
  const today = startOfToday();
  const days = Array.from({ length: DAYS }, (_, i) => addDays(today, i));
  const unavailable = (d: Date, h: number) => {
    const s = slotAt(d, h);
    return isPast(s) || isSlotTaken(s, sessions, ignoreSessionId);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-medium">Day</span>
        <div role="group" aria-label="Day" className="grid grid-cols-7 gap-1 sm:gap-1.5">
          {days.map((d) => {
            const selected = !!day && day.toDateString() === d.toDateString();
            const full = SLOT_HOURS.every((h) => unavailable(d, h));
            return (
              <button
                key={d.toDateString()}
                type="button"
                aria-pressed={selected}
                aria-label={d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
                disabled={full}
                onClick={() => onChange(d, hour !== null && unavailable(d, hour) ? null : hour)}
                className={cn(chip(selected), "py-2")}
              >
                <span className="block text-xs uppercase opacity-70">{d.toLocaleDateString(undefined, { weekday: "short" })}</span>
                <span className="block text-[16px] leading-tight tabular-nums">{d.getDate()}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="flex flex-wrap items-baseline justify-between gap-x-3 text-[13px] font-medium">
          Time
          <span className="text-xs font-normal text-ink-3">Greyed out = past, or you already have an interview then</span>
        </span>
        <div role="group" aria-label="Time" className="grid grid-cols-5 gap-1.5">
          {SLOT_HOURS.map((h) => {
            const off = !day || unavailable(day, h);
            const selected = hour === h && !off;
            return (
              <button
                key={h}
                type="button"
                aria-pressed={selected}
                disabled={off}
                onClick={() => onChange(day, h)}
                className={cn(chip(selected), "h-[36px] text-[12.5px] tabular-nums")}
              >
                {hourLabel(h)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
