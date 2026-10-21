import Link from "next/link";
import { Card, EmptyState, SectionHeader, StatusDot } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { levelLabel } from "@/lib/constants/engineering-levels";
import { ROUND_OPTIONS } from "@/lib/constants/interview";
import { ROUTES } from "@/lib/constants/shared";
import type { InterviewSession } from "@/features/interview";
import { statusDotState } from "@/app/(app)/interviews/_components/StatusPill";
import { cn } from "@/lib/utils/cn";
import { sessionPill, weekSessions } from "./sessions";

const ROUND_LABEL = new Map(ROUND_OPTIONS.map((r) => [r.value, r.label]));

/** "Mon" and "20": the day tile on an agenda row. */
function dayParts(iso: string): { weekday: string; day: string } {
  const d = new Date(iso);
  return { weekday: d.toLocaleDateString("en-US", { weekday: "short" }), day: String(d.getDate()) };
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

const MAX_ROWS = 5;

/** The next seven days of booked rounds, from the same sessions as the calendar. */
export function WeekAgenda({
  sessions,
  now = new Date(),
  className,
}: {
  sessions: InterviewSession[];
  now?: Date;
  className?: string;
}) {
  const week = weekSessions(sessions, now);
  const shown = week.slice(0, MAX_ROWS);
  return (
    <div className={cn("flex flex-col", className)}>
      <SectionHeader title="This week" />
      <Card aria-label="This week" className="flex-1">
        {week.length === 0 ? (
          <EmptyState
            className="my-auto py-6"
            title="Nothing this week"
            hint="Rounds you book for the next seven days show up here."
          >
            <Button asChild variant="secondary">
              <Link href={ROUTES.interviews}>Book a round</Link>
            </Button>
          </EmptyState>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {shown.map((s, i) => {
              const { weekday, day } = dayParts(s.scheduledAt);
              const title = `${ROUND_LABEL.get(s.roundType) ?? s.roundType} · ${s.companyName ?? s.company}`;
              return (
                <li key={s.id} className={i === 0 ? "pb-3" : "border-t border-line py-3"}>
                  <Link
                    href={`${ROUTES.interviews}/${s.id}`}
                    className="flex items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  >
                    <span
                      aria-hidden
                      className="flex h-11 w-11 flex-none flex-col items-center justify-center rounded-xl bg-surface leading-none shadow-ring"
                    >
                      <span className="text-[11px] text-ink-3">{weekday}</span>
                      <span className="mt-1 font-display text-[16px] tabular-nums">{day}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium" title={title}>
                        {title}
                      </span>
                      <small className="mt-0.5 block truncate text-[12.5px] text-ink-3">
                        {timeOf(s.scheduledAt)} · {levelLabel(s.level)}
                      </small>
                    </span>
                    <StatusDot state={statusDotState(s.status)} label={sessionPill(s).label} className="flex-none" />
                  </Link>
                </li>
              );
            })}
            {week.length > MAX_ROWS ? (
              <li className="border-t border-line pt-3 text-[12.5px] text-ink-3">+{week.length - MAX_ROWS} more this week</li>
            ) : null}
          </ul>
        )}
      </Card>
    </div>
  );
}
