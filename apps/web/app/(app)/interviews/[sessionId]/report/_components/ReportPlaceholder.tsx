"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUTES } from "@/lib/constants/shared";
import { useSession, type InterviewSession } from "@/features/interview";
import {
  bookingHref,
  companyLabel,
  formatSlot,
  isFinished,
  levelLabel,
  roundLabel,
} from "@/features/interview/presentation";
import { StatusPill } from "../../../_components/StatusPill";
import { PAGE_SCAFFOLD } from "@/components/layout/page";

const PAGE = PAGE_SCAFFOLD;

/** What the debrief is for, from the product spec. Shown as a promise of shape, never as results. */
const WILL_CONTAIN = [
  {
    eyebrow: "Questions",
    title: "Every question, one by one",
    body: "What you said next to a strong answer, with feedback on the gap between them.",
  },
  {
    eyebrow: "Signals",
    title: "How the round went",
    body: "Correctness, approach, depth and communication, each traced back to your own answers.",
  },
  {
    eyebrow: "Learn next",
    title: "Topics to work on",
    body: "A short list drawn from the answers that needed the most help.",
  },
  {
    eyebrow: "Score",
    title: "An overall score",
    body: "Marked against this round's rubric, with the reasoning shown, once scoring ships.",
  },
];

function statusNote(session: InterviewSession): string {
  if (session.status === "COMPLETED") return "Round complete. Its questions, feedback and score will appear here once scoring is live.";
  if (session.status === "ABORTED_TECHNICAL") return "This round ended early because of a technical problem.";
  return "This round hasn't finished yet. Its debrief opens here afterwards.";
}

function BackLink() {
  return (
    <Link
      href={ROUTES.interviews}
      className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
      All interviews
    </Link>
  );
}

/**
 * The debrief for a session. There is no candidate-facing report or scoring contract yet, so this
 * is an honest placeholder in the design's debrief layout: the round from the session, an empty
 * score ("—"), and what the debrief will contain. It never shows sample questions or scores.
 */
export function ReportPlaceholder({ sessionId }: { sessionId: string }) {
  const { data: session, isLoading, error } = useSession(sessionId);

  if (isLoading) {
    return (
      <div className={PAGE} aria-busy="true">
        <p className="sr-only">Loading your debrief…</p>
        <Skeleton className="h-4 w-48" />
        <Skeleton className="mt-4 h-10 w-80 max-w-full" />
        <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2.2fr)]">
          <Skeleton className="h-72 rounded-[10px]" />
          <Skeleton className="h-72 rounded-[10px]" />
        </div>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className={PAGE}>
        <BackLink />
        <div className="mt-6 rounded-[10px] border border-dashed border-line-4 px-6 py-12 text-center">
          <p role="alert" className="m-0 text-sm text-foreground">
            Failed to load your interview session. Refresh the page to try again.
          </p>
        </div>
      </div>
    );
  }

  const finished = isFinished(session);

  return (
    <div className={PAGE}>
      <BackLink />

      <div className="mt-5 flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <p className="iq-eyebrow m-0">
            Debrief · {companyLabel(session)} · {levelLabel(session.level)}
          </p>
          <h1 className="m-0 mt-1.5 text-[26px] font-normal leading-[1.1] tracking-[-0.04em] sm:text-[30px]">
            {roundLabel(session.roundType)}
          </h1>
          <p className="m-0 mt-1.5 max-w-[560px] text-[14px] leading-[1.5] text-muted-foreground">{statusNote(session)}</p>
        </div>

        <div className="flex flex-wrap items-center gap-5">
          <div className="flex items-center gap-3">
            <span aria-hidden className="text-[56px] font-normal leading-none tracking-[-0.06em] text-faint-2 sm:text-[64px]">
              —
            </span>
            <span className="sr-only">No score yet.</span>
            <span className="max-w-[92px] text-[13px] leading-[1.35] text-faint">Scoring isn&apos;t live yet</span>
          </div>
          {finished ? (
            <Button asChild className="h-10 px-4 text-[13.5px]">
              <Link href={bookingHref({ jd: session.jobDescriptionId, round: session.roundType })}>
                Practise again
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          ) : (
            <Button asChild variant="strong" className="h-10 px-4 text-[13.5px]">
              <Link href={`${ROUTES.interviews}/${session.id}`}>View interview</Link>
            </Button>
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-start gap-3">
        <section
          aria-labelledby="debrief-round"
          className="min-w-0 flex-[1_1_260px] overflow-hidden rounded-[10px] border border-line-2"
        >
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-4 text-sm sm:px-5">
            <h2 id="debrief-round" className="m-0 text-sm font-normal">
              This round
            </h2>
            <StatusPill status={session.status} />
          </div>
          <dl className="m-0">
            {(
              [
                ["Role", session.role],
                ["Level", levelLabel(session.level)],
                ...(session.specialization ? [["Focus", session.specialization]] : []),
                ["Slot", formatSlot(session.scheduledAt)],
              ] as [string, string][]
            ).map(([label, value]) => (
              <div
                key={label}
                className="grid grid-cols-[88px_minmax(0,1fr)] gap-3 border-b border-line px-4 py-3 text-[13.5px] last:border-b-0 sm:px-5"
              >
                <dt className="text-faint">{label}</dt>
                <dd className="m-0 min-w-0 break-words">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section
          aria-labelledby="debrief-contents"
          className="flex min-w-0 flex-[2.2_1_440px] flex-col gap-4 rounded-[10px] bg-panel p-4 sm:p-5"
        >
          <h2 id="debrief-contents" className="iq-eyebrow m-0 font-normal">
            What your debrief will contain
          </h2>
          <ul className="m-0 grid list-none grid-cols-1 gap-2.5 p-0 sm:grid-cols-2">
            {WILL_CONTAIN.map((item) => (
              <li key={item.eyebrow} className="iq-float flex flex-col gap-1.5 p-4">
                <span className="iq-eyebrow">{item.eyebrow}</span>
                <span className="text-[15px] tracking-[-0.01em]">{item.title}</span>
                <span className="text-[13px] leading-[1.5] text-muted-foreground">{item.body}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
