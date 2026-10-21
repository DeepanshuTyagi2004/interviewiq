"use client";

import Link from "next/link";
import { Card, PageHeader, StatusDot, type DotState } from "@/components/ds";
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
  roleLabel,
  roundLabel,
  roundLength,
  sessionSteps,
  type SessionStep,
} from "@/features/interview/presentation";
import { StatusChip } from "../../_components/StatusPill";
import { BriefingCard } from "./BriefingCard";
import { PrepFailed } from "./PrepFailed";
import { PrepPanel } from "./PrepPanel";
import { SessionAction } from "./SessionAction";

/** One line on where the session stands, straight from its status. */
function statusLine(session: InterviewSession): string {
  switch (session.status) {
    case "SCHEDULED":
      return `Booked for ${formatSlot(session.scheduledAt)}. We're starting to prepare your interviewer.`;
    case "PREP_QUEUED":
      return "Your interviewer is being prepared from your profile and this role. This page updates on its own.";
    case "PREP_READY":
      return session.liveAvailable
        ? "Your interviewer is ready. Join whenever you're set up."
        : "Your interviewer is ready. Live sessions open soon.";
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
 * The step's dot on the rail. Done = solid ink, upcoming = hollow, failed = error. The current step
 * pulses only while that step is really running (prep in flight, or the round live); a current step
 * that's just waiting (ready to join, debrief) stays steady.
 */
function StepDot({ step, status }: { step: SessionStep; status: InterviewSession["status"] }) {
  if (step.state === "done") {
    return <span aria-hidden className="h-1.5 w-1.5 flex-none rounded-full bg-ink" />;
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

/** The lifecycle as a vertical step timeline: a dot per step on a hairline rail, the step and a short note. */
function Progress({ session }: { session: InterviewSession }) {
  const steps = sessionSteps(session.status, session.evaluationStatus);
  return (
    <Card title="Progress">
      <ol className="m-0 flex list-none flex-col p-0">
        {steps.map((step, i) => (
          <li key={step.key} className="relative flex items-start gap-3.5 pb-5 last:pb-0">
            {i < steps.length - 1 ? (
              <span aria-hidden data-rail className="absolute left-[5px] top-[23px] h-[calc(100%-23px)] w-px bg-line" />
            ) : null}
            <span className="relative flex h-[22px] w-[11px] flex-none items-center justify-center">
              <StepDot step={step} status={session.status} />
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("m-0 text-[14.5px] leading-[22px]", step.state === "upcoming" ? "text-ink-3" : "font-medium text-ink")}>
                {step.label}
              </p>
              <p className="m-0 mt-0.5 text-[13px] text-ink-3">
                {step.key === "booked" ? `Booked ${formatDate(session.createdAt)}` : step.note}
              </p>
            </div>
            <span className="sr-only">{STATE_TEXT[step.state]}</span>
          </li>
        ))}
      </ol>
      {!isFinished(session) ? (
        <p className="m-0 mt-5 border-t border-line pt-4 text-[13px] leading-[1.5] text-ink-3">
          The room runs full screen with your camera and microphone on. Leaving full screen or switching
          tabs pauses the round.
        </p>
      ) : null}
    </Card>
  );
}

function Details({ session }: { session: InterviewSession }) {
  const rows: [string, React.ReactNode][] = [
    ["Company", companyLabel(session)],
    ["Role", roleLabel(session.role)],
    ["Level", levelLabel(session.level)],
    ...(session.specialization ? ([["Focus", session.specialization]] as [string, React.ReactNode][]) : []),
    ["Round", roundLabel(session.roundType)],
    ...(roundLength(session) ? ([["Length", roundLength(session)]] as [string, React.ReactNode][]) : []),
    [
      "Slot",
      <>
        <span className="tabular-nums">{formatSlot(session.scheduledAt)}</span>
        <span className="block text-[12.5px] text-ink-3">
          {formatRelativeTime(session.scheduledAt)} · {session.timezone}
        </span>
      </>,
    ],
  ];

  return (
    <Card title="Details">
      <dl className="m-0 grid sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="grid min-w-0 content-start grid-cols-[110px_minmax(0,1fr)] gap-3 border-t border-line py-3 text-[14px] sm:grid-cols-1 sm:gap-0.5 sm:pr-4"
          >
            <dt className="text-ink-3">{label}</dt>
            <dd className="m-0 min-w-0 break-words text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** Session detail: status, the next action, the interviewer's briefing, the booking's facts and the lifecycle so far. */
export function SessionDetail({ sessionId }: { sessionId: string }) {
  const { data: session, isLoading, isError } = useSession(sessionId);

  if (isLoading) {
    return (
      <div aria-busy="true" aria-label="Loading interview">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-4 h-10 w-72 max-w-full" />
        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Skeleton className="h-80 rounded-card" />
          <Skeleton className="h-80 rounded-card" />
        </div>
      </div>
    );
  }

  if (isError || !session) {
    return (
      <div className="rounded-tile bg-surface">
        <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
          <p role="alert" className="m-0 font-display text-[20px] font-normal tracking-[-0.02em]">
            We couldn&apos;t load this interview.
          </p>
          <p className="m-0 text-[14px] text-ink-3">It may have been removed, or the link is wrong.</p>
          <Button asChild variant="outline" className="mt-3">
            <Link href={ROUTES.interviews}>All interviews</Link>
          </Button>
        </div>
      </div>
    );
  }

  const company = companyLabel(session);
  const preparing = session.status === "SCHEDULED" || session.status === "PREP_QUEUED";
  const eyebrow = `${company} · ${levelLabel(session.level)}`;

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        eyebrow={
          <span className="flex min-w-0 flex-wrap items-center gap-2.5">
            <StatusChip status={session.status} />
            <span className="min-w-0 truncate" title={eyebrow}>{eyebrow}</span>
          </span>
        }
        title={roundLabel(session.roundType)}
        description={statusLine(session)}
        actions={
          <>
            {isFinished(session) ? (
              <Button asChild variant="outline">
                <Link href={session.loopId && !session.jobDescriptionId ? `${ROUTES.loops}/${session.loopId}` : bookingHref({ jd: session.jobDescriptionId ?? undefined, round: session.roundType })}>Practise again</Link>
              </Button>
            ) : null}
            <SessionAction session={session} />
          </>
        }
      />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          {preparing ? <PrepPanel session={session} /> : null}
          {session.status === "PREP_FAILED" ? <PrepFailed session={session} /> : null}
          <BriefingCard session={session} />
          <Details session={session} />
        </div>
        <div className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-[76px]">
          <Progress session={session} />
        </div>
      </div>
    </div>
  );
}
