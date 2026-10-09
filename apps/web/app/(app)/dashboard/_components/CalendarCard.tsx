"use client";
import { levelLabel } from "@/lib/constants/engineering-levels";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { HudCard, StatusDot, padCount } from "@/components/hud";
import { Button } from "@/components/ui/button";
import { ROUND_OPTIONS } from "@/lib/constants/interview";
import { ROUTES } from "@/lib/constants/shared";
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
 * between months. Rows share whatever height the card gets, so it fits a viewport-fit screen.
 */
export function CalendarCard({ sessions, now = new Date(), className }: CalendarCardProps) {
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
    <HudCard
      title="Calendar"
      meta={
        <span className="uppercase">
          {monthCount} {monthCount === 1 ? "round" : "rounds"} this month
        </span>
      }
      tone="sunken"
      glow="t"
      active
      className={cn("min-h-0", className)}
      bodyClassName="flex min-h-0 flex-col"
    >
      <div className="flex min-h-0 flex-1 flex-col px-[calc(18*var(--u))] pb-[calc(22*var(--u))] pt-[calc(24*var(--u))] sm:px-[calc(26*var(--u))]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3
            aria-live="polite"
            className="m-0 text-[length:calc(34*var(--u))] font-normal leading-[1.1] tracking-[-0.035em]"
          >
            {monthName}
          </h3>
          <div className="flex items-center gap-[calc(8*var(--u))]">
            <Button
              type="button"
              variant="strong"
              onClick={() => select(now)}
              className="h-[calc(44*var(--u))] px-[calc(20*var(--u))] text-[length:calc(16*var(--u))]"
            >
              Today
            </Button>
            <Button
              type="button"
              variant="strong"
              aria-label="Previous month"
              onClick={() => setView((v) => addMonths(v, -1))}
              className="size-[calc(44*var(--u))] p-0 [&_svg]:size-[calc(18*var(--u))]"
            >
              <ChevronLeft aria-hidden />
            </Button>
            <Button
              type="button"
              variant="strong"
              aria-label="Next month"
              onClick={() => setView((v) => addMonths(v, 1))}
              className="size-[calc(44*var(--u))] p-0 [&_svg]:size-[calc(18*var(--u))]"
            >
              <ChevronRight aria-hidden />
            </Button>
          </div>
        </div>

        <div
          aria-hidden
          className="mt-[calc(22*var(--u))] grid grid-cols-7 gap-[calc(8*var(--u))] font-mono text-[length:calc(12*var(--u))] uppercase tracking-[0.18em] text-faint"
        >
          {WEEKDAYS.map((d) => (
            <span key={d} className="px-[calc(14*var(--u))]">
              {d}
            </span>
          ))}
        </div>

        <div
          ref={gridRef}
          role="group"
          aria-label={monthName}
          onKeyDown={onGridKeyDown}
          className="mt-[calc(14*var(--u))] grid flex-1 grid-cols-7 grid-rows-6 gap-[calc(8*var(--u))] lg:min-h-0"
        >
          {grid.map(({ date, key, inMonth }) => {
            if (!inMonth) {
              return (
                <span
                  key={key}
                  aria-hidden
                  className="px-[calc(14*var(--u))] py-[calc(11*var(--u))] font-mono text-[length:calc(15.5*var(--u))] tabular-nums text-faint-2"
                >
                  {padCount(date.getDate())}
                </span>
              );
            }
            const isToday = key === today;
            const isSelected = key === selectedKey;
            const list = byDay.get(key) ?? [];
            const first = list[0];
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
                  "flex min-h-[calc(56*var(--u))] min-w-0 flex-col items-start overflow-hidden rounded-[calc(8*var(--u))] border px-[calc(14*var(--u))] py-[calc(11*var(--u))] text-left font-mono text-[length:calc(15.5*var(--u))] tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring lg:min-h-0",
                  isSelected
                    ? cn("bg-foreground/[0.05]", isToday ? "border-brand" : "border-foreground/40")
                    : cn(
                        "bg-foreground/[0.02] hover:bg-foreground/[0.04]",
                        isToday ? "border-brand/40" : "border-foreground/[0.07] hover:border-line-4",
                      ),
                )}
              >
                <span aria-hidden className={cn("leading-none", isToday && "text-brand")}>
                  {padCount(date.getDate())}
                </span>
                {isToday ? (
                  <span
                    aria-hidden
                    className="mt-[calc(8*var(--u))] text-[length:calc(11.5*var(--u))] uppercase leading-none tracking-[0.16em] text-brand"
                  >
                    Today
                  </span>
                ) : null}
                {first ? (
                  <span
                    aria-hidden
                    className="mt-auto flex w-full min-w-0 items-center gap-[calc(5*var(--u))] pt-[calc(4*var(--u))] text-[length:calc(11*var(--u))] leading-none text-muted-foreground"
                  >
                    <span
                      className={cn(
                        "size-[calc(6*var(--u))] shrink-0 rounded-full",
                        isJoinable(first) ? "bg-brand" : isFinished(first) ? "bg-faint-2" : "bg-foreground/70",
                      )}
                    />
                    <span className="truncate">{roundLabel(first)}</span>
                    {list.length > 1 ? <span className="shrink-0 text-faint">+{list.length - 1}</span> : null}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div
        aria-live="polite"
        className="flex flex-wrap items-center gap-x-[calc(20*var(--u))] gap-y-3 border-t border-line bg-frame/60 px-[calc(18*var(--u))] py-[calc(22*var(--u))] sm:px-[calc(26*var(--u))]"
      >
        <div className="min-w-0 flex-1 basis-[240px]">
          <p className="iq-eyebrow m-0 text-brand">
            {dateEyebrow(selected)}
            {selectedKey === today ? " · Today" : ""}
          </p>
          {daySessions.length === 0 ? (
            <>
              <p className="m-0 mt-[calc(6*var(--u))] text-[length:calc(18*var(--u))] leading-snug">
                Nothing scheduled
              </p>
              <p className="m-0 mt-[calc(4*var(--u))] text-[length:calc(15*var(--u))] leading-[1.5] text-muted-foreground">
                Booked rounds appear on the day they happen.
              </p>
            </>
          ) : (
            <ul className="m-0 mt-[calc(6*var(--u))] flex list-none flex-col gap-[calc(6*var(--u))] p-0">
              {daySessions.slice(0, 2).map((s) => (
                <li key={s.id} className="min-w-0">
                  <Link
                    href={`${ROUTES.interviews}/${s.id}`}
                    className="flex min-w-0 items-center gap-[calc(10*var(--u))] text-[length:calc(16*var(--u))] hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <span className="shrink-0 font-mono text-[length:calc(13*var(--u))] tabular-nums text-faint">
                      {timeOf(s.scheduledAt)}
                    </span>
                    <span className="truncate">
                      {roundLabel(s)} · {s.companyName ?? s.company} {levelLabel(s.level)}
                    </span>
                    <StatusDot state={statusDotState(s.status)} label={sessionPill(s).label} className="shrink-0" />
                  </Link>
                </li>
              ))}
              {daySessions.length > 2 ? (
                <li className="font-mono text-[length:calc(12*var(--u))] uppercase tracking-[0.14em] text-faint">
                  +{daySessions.length - 2} more
                </li>
              ) : null}
            </ul>
          )}
        </div>
        <Button
          asChild
          variant={joinable ? "default" : "strong"}
          className="h-[calc(46*var(--u))] px-[calc(22*var(--u))] text-[length:calc(16*var(--u))]"
        >
          <RoomLink href={joinable ? sessionHref(joinable) : ROUTES.interviews}>
            {joinable ? "Enter room" : "Book a round"}
          </RoomLink>
        </Button>
      </div>
    </HudCard>
  );
}
