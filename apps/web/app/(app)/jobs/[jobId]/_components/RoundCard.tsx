"use client";

import Link from "next/link";
import { InterviewAccessNote } from "@/components/auth/InterviewAccessNote";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { Button } from "@/components/ui/button";
import { padCount } from "@/components/hud";
import { Chip } from "@/components/ds";
import { cn } from "@/lib/utils/cn";
import type { ConsolidatedRound } from "@/features/jobs";
import {
  bookHref,
  isOnlineAssessment,
  roundEvidence,
  roundMeta,
  roundNumber,
  roundTitle,
  roundTopics,
  toRoundType,
} from "./rounds";

export interface RoundCardProps {
  round: ConsolidatedRound;
  index: number;
  jdId: string;
  /** Position among interview rounds only (info rounds are not numbered). */
  number?: number;
  practiceTemplate?: boolean;
}

/**
 * One round of the suggested process, as a node on the rounds timeline: `R01` tile, title,
 * format/difficulty, topic chips and a booking link. Deliberately no locked, cleared or scored
 * state: gating isn't built.
 */
export function RoundCard({ round, index, jdId, number, practiceTemplate = false }: RoundCardProps) {
  const { canInterview, interviewBlocked } = useCurrentUser();
  const info = round.kind === "info";
  const n = number ?? roundNumber(round, index);
  const title = roundTitle(round, index);
  const meta = roundMeta(round);
  const topics = roundTopics(round);
  const mapped = toRoundType(round.type) !== null;
  const note = info ? "Not an interview round, for information only" : practiceTemplate ? "Practice template" : isOnlineAssessment(round.type) ? "Automated test · not run as a mock" : roundEvidence(round);
  const cta = mapped ? "Book this round" : "Book a round";
  const sources = practiceTemplate ? [] : [...new Set(round.source_urls?.map((url) => url.trim()).filter(Boolean) ?? [])];
  const questions = [...new Set(round.problems?.map((question) => question.trim()).filter(Boolean) ?? [])];

  const disclosure = "mt-1 text-[13px]";
  const summary = "cursor-pointer text-ink-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm";
  return (
    <li
      className={cn(
        "grid grid-cols-[48px_minmax(0,1fr)] items-start gap-x-4 gap-y-3.5 rounded-card p-4 sm:grid-cols-[56px_minmax(0,1fr)_auto] sm:items-center sm:gap-x-5 sm:p-5",
        info ? "border border-dashed border-line-4 bg-transparent" : "border border-line bg-background shadow-ring",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex h-12 w-12 items-center justify-center rounded-2xl font-mono text-[13px] tabular-nums sm:h-14 sm:w-14 sm:text-[14px]",
          info ? "border border-dashed border-line-4 text-ink-3" : "bg-surface-2 text-foreground",
        )}
      >
        {info ? "i" : `R${padCount(n)}`}
      </span>

      <div className="flex min-w-0 flex-col gap-1.5">
        <h3 title={title} className="m-0 break-words font-display text-[20px] font-normal leading-tight tracking-[-0.02em]">
          <span className="sr-only">{info ? "Info step" : `Round ${n}`}: </span>
          {title}
        </h3>
        {meta ? <p className="m-0 text-[13px] leading-[1.45] text-ink-3">{meta}</p> : null}
        {topics.length > 0 ? (
          <ul aria-label={`${title} topics`} className="m-0 mt-1 flex list-none flex-wrap gap-1.5 p-0">
            {topics.map((t) => (
              <li key={t}>
                <Chip className="max-w-full">
                  <span className="truncate" title={t}>{t}</span>
                </Chip>
              </li>
            ))}
          </ul>
        ) : null}
        {questions.length ? (
          <details className={disclosure}>
            <summary className={summary}>Practice questions</summary>
            <ul className="mb-0 mt-2 flex list-none flex-col gap-2 p-0">
              {questions.map((question) => (
                <li key={question} className="whitespace-pre-wrap break-words leading-relaxed text-ink-2">{question}</li>
              ))}
            </ul>
          </details>
        ) : null}
        {sources.length ? (
          <details className={disclosure}>
            <summary className={summary}>Round sources</summary>
            <ul className="mb-0 mt-2 flex list-none flex-col gap-2 p-0">
              {sources.map((url) => (
                <li key={url}>
                  <a href={url} target="_blank" rel="noreferrer" className="break-all text-xs text-ink-2 underline underline-offset-4 hover:text-foreground">{url}</a>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      <div className="col-start-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 sm:col-start-3 sm:flex-col sm:items-end sm:justify-center">
        {note ? <span className="text-[12.5px] text-ink-3">{note}</span> : null}
        {info ? null : interviewBlocked ? (
          <InterviewAccessNote />
        ) : !canInterview ? null : (
          <Button asChild variant="secondary" size="sm">
            <Link href={bookHref(jdId, round.type)} aria-label={`${cta}: ${title}`}>
              {cta}
            </Link>
          </Button>
        )}
      </div>
    </li>
  );
}
