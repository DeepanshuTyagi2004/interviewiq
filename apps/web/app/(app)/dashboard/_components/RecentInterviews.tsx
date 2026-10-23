"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { InterviewAccessNote } from "@/components/auth/InterviewAccessNote";
import { Chip, EmptyState, Orb, SectionHeader } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { levelLabel } from "@/lib/constants/engineering-levels";
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
    <section aria-label="Recent results" className={className}>
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
      {isLoading ? (
        <div className="flex flex-col gap-2 rounded-tile p-4 shadow-ring" aria-busy="true" aria-label="Loading interviews">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : isError ? (
        <p role="alert" className="m-0 rounded-tile px-5 py-6 text-sm text-destructive shadow-ring">
          Couldn&apos;t load your interviews. Refresh to try again.
        </p>
      ) : sessions.length === 0 ? (
        <div className="rounded-tile shadow-ring">
          <EmptyState
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
        </div>
      ) : (
        <Table className="min-w-[640px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[34%] px-5">Round</TableHead>
              <TableHead>Track</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Outcome</TableHead>
              <TableHead className="w-10 pr-5">
                <span className="sr-only">Report</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((s) => {
              const round = ROUND_LABEL.get(s.roundType) ?? s.roundType;
              const company = s.companyName ?? s.company;
              const track = s.loopId ? `${company} ${levelLabel(s.level)}` : "Standalone";
              const score = scoreText(s.score);
              const chip = outcomeChip(s, now);
              return (
                <TableRow key={s.id} className="relative">
                  <TableCell className="px-5">
                    <div className="flex min-w-0 items-center gap-3">
                      <Orb seed={s.id} size={34} />
                      <div className="min-w-0">
                        <Link
                          href={`${ROUTES.interviews}/${s.id}/report`}
                          title={`${round} · ${company}`}
                          className="block max-w-[260px] truncate rounded-sm font-medium outline-none after:absolute after:inset-0 after:content-[''] focus-visible:ring-2 focus-visible:ring-brand"
                        >
                          {round}
                        </Link>
                        <small className="block max-w-[260px] truncate text-[12.5px] text-ink-3">{company}</small>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="block max-w-[200px] truncate" title={track}>
                      {track}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-ink-2">{dayMonth(s.scheduledAt)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {score ? (
                      <span className="font-display text-[20px] tracking-[-0.02em] tabular-nums">
                        {score}
                        <small className="font-sans text-[12px] text-ink-3"> /10</small>
                      </span>
                    ) : (
                      <>
                        <span aria-hidden className="text-ink-3">—</span>
                        <span className="sr-only">No score</span>
                      </>
                    )}
                  </TableCell>
                  <TableCell>
                    <Chip
                      tone={chip.tone === "passed" ? "default" : "outline"}
                      dot={chip.tone === "passed" ? "filled" : "hollow"}
                      className={cn(chip.tone === "neutral" && "text-ink-3")}
                    >
                      {chip.label}
                    </Chip>
                  </TableCell>
                  <TableCell className="pr-5">
                    <ChevronRight aria-hidden className="h-4 w-4 text-ink-3" strokeWidth={1.8} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
