"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card, SectionHeader, StatusDot } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { levelLabel } from "@/lib/constants/engineering-levels";
import { ROUND_OPTIONS } from "@/lib/constants/interview";
import { ROUTES } from "@/lib/constants/shared";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { cn } from "@/lib/utils/cn";
import type { InterviewSession } from "@/features/interview";
import { isJoinable } from "@/features/interview/presentation";
import { statusDotState } from "@/app/(app)/interviews/_components/StatusPill";
import {
  addDays,
  addMonths,
  countInMonth,
  dayKey,
  monthGrid,
  sameMonth,
  sessionsByDay,
  startOfMonth,
} from "./calendar";
import { dateEyebrow } from "./Greeting";
import { isFinished, sessionHref, sessionPill } from "./sessions";
import { RoomLink } from "@/features/interview-live/RoomLink";

const ROUND_LABEL = new Map(ROUND_OPTIONS.map((r) => [r.value, r.label]));
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Arrow keys move the selected day by these many days. */
const KEY_STEP: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

function roundLabel(s: InterviewSession): string {
  return ROUND_LABEL.get(s.roundType) ?? s.roundType;
}

function dayLabel(date: Date, isToday: boolean, count: number): string {
  const day = date.toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const rounds = count ? `, ${count} ${count === 1 ? "round" : "rounds"}` : "";
  return `${day}${isToday ? ", today" : ""}${rounds}`;
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export interface CalendarCardProps {
  sessions: InterviewSession[];
  now?: Date;
  className?: string;
}

/**
 * The month at a glance: every booked round on the day it happens, with the selected day's rounds
 * (or a nudge to book one) in the strip below. Arrow keys move between days, PageUp/PageDown
 * between months.
 */
export function CalendarCard({ sessions, now = new Date(), className }: CalendarCardProps) {
  const { canInterview } = useCurrentUser();
  const today = dayKey(now);
  const [view, setView] = useState(() => startOfMonth(now));
  const [selected, setSelected] = useState(() => now);
  const gridRef = useRef<HTMLDivElement>(null);
  const focusAfterMove = useRef(false);

  const byDay = useMemo(() => sessionsByDay(sessions), [sessions]);
  const grid = useMemo(() => monthGrid(view), [view]);
  const monthCount = countInMonth(byDay, view);
  const selectedKey = dayKey(selected);
  // One tab stop in the grid: the selected day when it's on screen, else the 1st.
  const tabKey = sameMonth(selected, view) ? selectedKey : dayKey(view);

  useEffect(() => {
    if (!focusAfterMove.current) return;
    focusAfterMove.current = false;
    gridRef.current?.querySelector<HTMLElement>(`[data-day="${selectedKey}"]`)?.focus();
  }, [selectedKey, view]);

  function select(date: Date, focus = false) {
    setSelected(date);
    if (!sameMonth(date, view)) setView(startOfMonth(date));
    focusAfterMove.current = focus;
  }

  function onGridKeyDown(e: React.KeyboardEvent) {
    if (e.key in KEY_STEP) {
      e.preventDefault();
      select(addDays(selected, KEY_STEP[e.key]), true);
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      const month = addMonths(selected, e.key === "PageUp" ? -1 : 1);
      const lastDay = addDays(addMonths(month, 1), -1).getDate();
      select(new Date(month.getFullYear(), month.getMonth(), Math.min(selected.getDate(), lastDay)), true);
    }
  }

  const daySessions = byDay.get(selectedKey) ?? [];
  const joinable = daySessions.find(isJoinable);
  const monthName = view.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className={cn("flex flex-col", className)}>
      <SectionHeader
        title="Calendar"
        actions={
          <span className="text-[13px] text-ink-3">
            {monthCount} {monthCount === 1 ? "round" : "rounds"} this month
          </span>
        }
      />
      <Card aria-label="Calendar" className="flex-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3
            aria-live="polite"
            className="m-0 font-display text-[22px] font-normal leading-tight tracking-[-0.03em]"
          >
            {monthName}
          </h3>
          <div className="flex items-center gap-1.5">
            <Button type="button" variant="outline" size="sm" onClick={() => select(now)}>
              Today
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8"
              aria-label="Previous month"
              onClick={() => setView((v) => addMonths(v, -1))}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8"
              aria-label="Next month"
              onClick={() => setView((v) => addMonths(v, 1))}
            >
              <ChevronRight aria-hidden />
            </Button>
          </div>
        </div>

        <div aria-hidden className="mt-4 grid grid-cols-7 gap-1 text-center text-[12px] text-ink-3">
          {WEEKDAYS.map((d) => (
            <span key={d}>{d}</span>
          ))}
        </div>

        <div
          ref={gridRef}
          role="group"
          aria-label={monthName}
          onKeyDown={onGridKeyDown}
          className="mt-1.5 grid grid-cols-7 gap-1"
        >
          {grid.map(({ date, key, inMonth }) => {
            if (!inMonth) {
              return (
                <span
                  key={key}
                  aria-hidden
                  className="grid h-10 place-items-center text-[13px] tabular-nums text-ink-3 opacity-40"
                >
                  {date.getDate()}
                </span>
              );
            }
            const isToday = key === today;
            const isSelected = key === selectedKey;
            const list = byDay.get(key) ?? [];
            return (
              <button
                key={key}
                type="button"
                data-day={key}
                tabIndex={key === tabKey ? 0 : -1}
                aria-pressed={isSelected}
                aria-label={dayLabel(date, isToday, list.length)}
                onClick={() => select(date)}
                className={cn(
                  "relative grid h-10 min-w-0 place-items-center rounded-xl text-[13px] tabular-nums outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                  isSelected ? "bg-ink font-medium text-background" : "hover:bg-surface-2",
                  isToday && !isSelected && "font-medium shadow-[inset_0_0_0_1.5px_hsl(var(--ink))]",
                )}
              >
                <span aria-hidden>{date.getDate()}</span>
                {list.length > 0 ? (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute bottom-1 h-1 w-1 rounded-full bg-current",
                      !isSelected && list.every(isFinished) && "opacity-40",
                    )}
                  />
                ) : null}
              </button>
            );
          })}
        </div>

        <div aria-live="polite" className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-line pt-4">
          <div className="min-w-0 flex-1 basis-[200px]">
            <p className="m-0 text-[12.5px] text-ink-3">
              {dateEyebrow(selected)}
              {selectedKey === today ? " · Today" : ""}
            </p>
            {daySessions.length === 0 ? (
              <>
                <p className="m-0 mt-1 text-[15px] font-medium">Nothing scheduled</p>
                <p className="m-0 mt-0.5 text-[13px] leading-[1.5] text-ink-3">Booked rounds appear on the day they happen.</p>
              </>
            ) : (
              <ul className="m-0 mt-1.5 flex list-none flex-col gap-1.5 p-0">
                {daySessions.slice(0, 2).map((s) => (
                  <li key={s.id} className="min-w-0">
                    <Link
                      href={`${ROUTES.interviews}/${s.id}`}
                      className="flex min-w-0 items-center gap-2.5 rounded-md text-[14px] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      <span className="shrink-0 text-[12.5px] tabular-nums text-ink-3">{timeOf(s.scheduledAt)}</span>
                      <span className="truncate">
                        {roundLabel(s)} · {s.companyName ?? s.company} {levelLabel(s.level)}
                      </span>
                      <StatusDot state={statusDotState(s.status)} label={sessionPill(s).label} className="shrink-0" />
                    </Link>
                  </li>
                ))}
                {daySessions.length > 2 ? (
                  <li className="text-[12.5px] text-ink-3">+{daySessions.length - 2} more</li>
                ) : null}
              </ul>
            )}
          </div>
          {canInterview ? (
            <Button asChild size="sm" variant={joinable ? "default" : "outline"}>
              <RoomLink href={joinable ? sessionHref(joinable) : ROUTES.interviews}>
                {joinable ? "Enter room" : "Book a round"}
              </RoomLink>
            </Button>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
