"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { HudCard, StatusDot, padCount, type DotState } from "@/components/hud";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils/cn";
import { ROUTES } from "@/lib/constants/shared";
import { formatDate, formatRelativeTime } from "@/lib/utils/format";
import { useSession, type InterviewSession } from "@/features/interview";
import {
  bookingHref,
  companyLabel,
  formatSlot,
  isFinished,
  levelLabel,
  roundLabel,
  sessionSteps,
  type SessionStep,
} from "@/features/interview/presentation";
import { StatusPill } from "../../_components/StatusPill";
import { SessionAction } from "./SessionAction";
import { PAGE_SCAFFOLD } from "@/components/layout/page";

const PAGE = PAGE_SCAFFOLD;

/** One line on where the session stands, straight from its status. */
function statusLine(session: InterviewSession): string {
  switch (session.status) {
    case "SCHEDULED":
      return `Booked for ${formatSlot(session.scheduledAt)}. We prepare your interviewer ahead of the slot.`;
    case "PREP_QUEUED":
      return "Your interviewer is being prepared from your profile and this role. This page updates on its own.";
    case "PREP_READY":
      return "Your interviewer is ready. Join whenever you're set up.";
    case "PREP_FAILED":
      return "We couldn't prepare this interview. Retry and we'll try again.";
    case "LIVE_IN_PROGRESS":
      return "This round is in progress. Rejoin to carry on.";
    case "COMPLETED":
      return "This round is done. Its debrief is ready to open.";
    case "ABORTED_TECHNICAL":
      return "This round ended early because of a technical problem.";
    default:
      return "";
  }
}

/**
 * The step's dot on the rail. Done = solid ink, upcoming = idle, failed = error. The current step
 * is the brand dot, and it pulses only while that step is really running (prep in flight, or the
 * round live); a current step that's just waiting (ready to join, debrief) stays steady.
 */
function StepDot({ step, status }: { step: SessionStep; status: InterviewSession["status"] }) {
  if (step.state === "done") {
    return <span aria-hidden className="h-1.5 w-1.5 flex-none rounded-full bg-foreground" />;
  }
  const running =
    step.state === "current" &&
    (step.key === "prep" || (step.key === "interview" && status === "LIVE_IN_PROGRESS"));
  const state: DotState =
    step.state === "failed" ? "error" : step.state === "upcoming" ? "idle" : running ? "live" : "active";
  return <StatusDot state={state} />;
}

const STATE_TEXT: Record<SessionStep["state"], string> = {
  done: "Done",
  current: "Now",
  upcoming: "Not yet",
  failed: "Needs attention",
};

/**
 * The lifecycle as a vertical step timeline: a dot per step on a 1px rail, the step with its mono
 * index, and a short note. The rail is drawn per step, from this dot down to the next one.
 */
function Progress({ session }: { session: InterviewSession }) {
  const steps = sessionSteps(session.status);
  return (
    <section aria-labelledby="session-progress" className="flex min-w-0 flex-col gap-4 rounded-[14px] bg-panel p-4 sm:p-5">
      <h2 id="session-progress" className="iq-eyebrow m-0 font-normal">
        Progress
      </h2>
      <ol className="iq-float m-0 flex list-none flex-col px-4 py-1.5">
        {steps.map((step, i) => (
          <li key={step.key} className="relative flex items-start gap-3.5 py-3">
            {i < steps.length - 1 ? (
              <span aria-hidden data-rail className="absolute left-[5px] top-[23px] h-full w-px bg-line-3" />
            ) : null}
            <span className="relative flex h-[22px] w-[11px] flex-none items-center justify-center">
              <StepDot step={step} status={session.status} />
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "m-0 flex items-baseline gap-2 text-[14.5px] leading-[22px]",
                  step.state === "upcoming" ? "text-faint" : "text-foreground",
                )}
              >
                <span aria-hidden className="font-mono text-[11px] tabular-nums text-faint">
                  {padCount(i + 1)}
                </span>
                {step.label}
              </p>
              <p className="m-0 mt-0.5 text-[12.5px] text-muted-foreground">
                {step.key === "booked" ? `Booked ${formatDate(session.createdAt)}` : step.note}
              </p>
            </div>
            <span className="sr-only">{STATE_TEXT[step.state]}</span>
          </li>
        ))}
      </ol>
      {!isFinished(session) ? (
        <p className="m-0 text-[13px] leading-[1.5] text-muted-foreground">
          The room runs full screen with your camera and microphone on. Leaving full screen or switching
          tabs pauses the round.
        </p>
      ) : null}
    </section>
  );
}

function Details({ session }: { session: InterviewSession }) {
  const rows: [string, React.ReactNode][] = [
    ["Company", companyLabel(session)],
    ["Role", session.role],
    ["Level", levelLabel(session.level)],
    ...(session.specialization ? ([["Focus", session.specialization]] as [string, React.ReactNode][]) : []),
    ["Round", roundLabel(session.roundType)],
    [
      "Slot",
      <>
        <span className="font-mono tabular-nums">{formatSlot(session.scheduledAt)}</span>
        <span className="block text-xs text-faint">{formatRelativeTime(session.scheduledAt)}</span>
      </>,
    ],
    ["Time zone", <span key="tz" className="font-mono">{session.timezone}</span>],
    ...(session.status === "PREP_FAILED" && session.prepError
      ? ([["Error code", <span key="err" className="font-mono">{session.prepError}</span>]] as [string, React.ReactNode][])
      : []),
  ];

  return (
    <HudCard title="Details">
      <dl className="m-0">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 border-b border-line px-4 py-3 text-[13.5px] last:border-b-0 sm:px-5"
          >
            <dt className="text-faint">{label}</dt>
            <dd className="m-0 min-w-0 break-words text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </HudCard>
  );
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

/** Session detail: status, the next action, the lifecycle so far and the booking's facts. */
export function SessionDetail({ sessionId }: { sessionId: string }) {
  const { data: session, isLoading, isError } = useSession(sessionId);

  if (isLoading) {
    return (
      <div className={PAGE} aria-busy="true" aria-label="Loading interview">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-4 h-10 w-72 max-w-full" />
        <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Skeleton className="h-80 rounded-[14px]" />
          <Skeleton className="h-80 rounded-[14px]" />
        </div>
      </div>
    );
  }

  if (isError || !session) {
    return (
      <div className={PAGE}>
        <BackLink />
        <div className="mt-6 rounded-[14px] border border-dashed border-line-4 px-6 py-12 text-center">
          <p role="alert" className="m-0 text-sm text-foreground">
            We couldn&apos;t load this interview.
          </p>
          <p className="m-0 mt-1 text-sm text-muted-foreground">It may have been removed, or the link is wrong.</p>
        </div>
      </div>
    );
  }

  const company = companyLabel(session);

  return (
    <div className={PAGE}>
      <BackLink />
      <div className="mt-5 flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <p className="iq-eyebrow m-0">
            Interview · {company} · {levelLabel(session.level)}
          </p>
          <h1 className="m-0 mt-1.5 text-[26px] font-normal leading-[1.1] tracking-[-0.04em] sm:text-[30px]">
            {roundLabel(session.roundType)}
          </h1>
          <p className="m-0 mt-1.5 max-w-[620px] text-[14px] leading-[1.5] text-muted-foreground">{statusLine(session)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill status={session.status} />
          {isFinished(session) ? (
            <Button asChild variant="strong" className="h-10 px-4 text-[13.5px]">
              <Link href={bookingHref({ jd: session.jobDescriptionId, round: session.roundType })}>Practise again</Link>
            </Button>
          ) : null}
          <SessionAction session={session} />
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Progress session={session} />
        <Details session={session} />
      </div>
    </div>
  );
}
