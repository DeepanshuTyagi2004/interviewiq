"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { InterviewAccessNote } from "@/components/auth/InterviewAccessNote";
import { Chip, EmptyState, Orb, SectionHeader } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUND_OPTIONS } from "@/lib/constants/interview";
import { ROUTES } from "@/lib/constants/shared";
import type { InterviewSession } from "@/features/interview";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { cn } from "@/lib/utils/cn";
import { dayMonth, outcomeChip, scoreText } from "./sessions";

const ROUND_LABEL = new Map(ROUND_OPTIONS.map((r) => [r.value, r.label]));

export interface RecentInterviewsProps {
  sessions: InterviewSession[];
  isLoading: boolean;
  isError: boolean;
  now?: Date;
  className?: string;
}

/** Finished rounds with their score and outcome; each row links to its report. */
export function RecentInterviews({ sessions, isLoading, isError, now = new Date(), className }: RecentInterviewsProps) {
  const { interviewBlocked } = useCurrentUser();
  return (
    <section aria-label="Recent results" className={cn("flex flex-col", className)}>
      <SectionHeader
        title="Recent results"
        href={ROUTES.interviews}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={ROUTES.interviews} aria-label="All interviews">
              View all
            </Link>
          </Button>
        }
      />
      <div className="iq-glass-card flex-1 p-1.5">
        {isLoading ? (
          <div className="flex flex-col gap-2 p-3" aria-busy="true" aria-label="Loading interviews">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : isError ? (
          <p role="alert" className="m-0 px-4 py-5 text-sm text-destructive">
            Couldn&apos;t load your interviews. Refresh to try again.
          </p>
        ) : sessions.length === 0 ? (
          <EmptyState
            inline
            orbSize={48}
            className="my-auto"
            title="No results yet"
            hint="Every round you finish shows up here with its score and debrief."
          >
            {interviewBlocked ? (
              <InterviewAccessNote />
            ) : (
              <Button asChild variant="secondary">
                <Link href={ROUTES.interviews}>Schedule a round</Link>
              </Button>
            )}
          </EmptyState>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0">
            {sessions.map((s) => {
              const round = ROUND_LABEL.get(s.roundType) ?? s.roundType;
              const company = s.companyName ?? s.company;
              const score = scoreText(s.score);
              const chip = outcomeChip(s, now);
              return (
                <li key={s.id} className="relative rounded-2xl px-3 py-2.5 transition-colors hover:bg-foreground/[0.04]">
                  <div className="flex min-w-0 items-center gap-3">
                    <Orb seed={s.id} size={30} />
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`${ROUTES.interviews}/${s.id}/report`}
                        title={`${round} · ${company}`}
                        className="block truncate rounded-sm text-[14px] font-medium outline-none after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-brand"
                      >
                        {round}
                      </Link>
                      <small className="block truncate text-[12.5px] text-ink-3">
                        {company} · {dayMonth(s.scheduledAt)}
                      </small>
                    </div>
                    {score ? (
                      <span className="flex-none font-display text-[18px] tabular-nums tracking-[-0.02em]">
                        {score}
                        <small className="font-sans text-[12px] text-ink-3"> /10</small>
                      </span>
                    ) : null}
                    <Chip
                      tone={chip.tone === "passed" ? "default" : "outline"}
                      dot={chip.tone === "passed" ? "filled" : "hollow"}
                      className={cn("flex-none", chip.tone === "neutral" && "text-ink-3")}
                    >
                      {chip.label}
                    </Chip>
                    <ChevronRight aria-hidden className="h-4 w-4 flex-none text-ink-3" strokeWidth={1.8} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
