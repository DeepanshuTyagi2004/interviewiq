"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { InterviewAccessNote } from "@/components/auth/InterviewAccessNote";
import { Count, EmptyState, Orb, SectionHeader } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { cn } from "@/lib/utils/cn";
import { ROUTES } from "@/lib/constants/shared";
import { useMySessions, type InterviewSession } from "@/features/interview";
import {
  companyLabel,
  formatSlot,
  levelLabel,
  partitionSessions,
  roundLabel,
} from "@/features/interview/presentation";
import { scoreChipText } from "@/features/report/presentation";
import { RetryPrepButton } from "./RetryPrepButton";
import { StatusPill } from "./StatusPill";
import { RoomLink } from "@/features/interview-live/RoomLink";

/** The one action a row offers, keyed on status: join, rejoin, retry prep, or open the debrief. */
function RowAction({ session }: { session: InterviewSession }) {
  const { interviewBlocked } = useCurrentUser();
  const base = `${ROUTES.interviews}/${session.id}`;

  switch (session.status) {
    case "PREP_READY":
      if (interviewBlocked) return <InterviewAccessNote className="relative z-10" />;
      return session.liveAvailable ? (
        <Button asChild size="sm" className="relative z-10">
          <RoomLink href={`${base}/live`}>Join</RoomLink>
        </Button>
      ) : (
        <Button size="sm" variant="outline" disabled className="relative z-10" title="Live sessions open soon">
          Ready
        </Button>
      );
    case "LIVE_IN_PROGRESS":
      if (interviewBlocked) return <InterviewAccessNote className="relative z-10" />;
      return (
        <Button asChild size="sm" className="relative z-10">
          <RoomLink href={`${base}/live`}>Rejoin</RoomLink>
        </Button>
      );
    case "PREP_FAILED":
      return <RetryPrepButton session={session} label="Retry" size="sm" variant="outline" className="relative z-10" />;
    case "COMPLETED":
    case "ABORTED_TECHNICAL":
      return (
        <Button asChild size="sm" variant="outline" className="relative z-10">
          <Link href={`${base}/report`}>Debrief</Link>
        </Button>
      );
    default:
      return <ChevronRight aria-hidden className="h-4 w-4 text-ink-3" />;
  }
}

/**
 * One session in the design's list-row language: round · company over a faint meta line, the
 * status pill, and the row's action. The whole row opens the session (a stretched link), with the
 * action button layered above it.
 */
function SessionRow({ session }: { session: InterviewSession }) {
  const title = `${roundLabel(session.roundType)} · ${companyLabel(session)}`;
  const meta = [levelLabel(session.level), formatSlot(session.scheduledAt)].join(" · ");
  const score = scoreChipText(session.score, session.passMark);

  return (
    <li className="border-b border-line last:border-b-0">
      <div
        className={cn(
          "relative grid items-center gap-x-3.5 gap-y-2 px-4 py-3.5 transition-colors duration-150 hover:bg-surface has-[a:focus-visible]:bg-surface sm:px-5",
          "grid-cols-[auto_minmax(0,1fr)_auto] [grid-template-areas:'orb_main_act'_'orb_pill_act']",
          "sm:grid-cols-[auto_minmax(0,1fr)_auto_minmax(88px,auto)] sm:[grid-template-areas:'orb_main_pill_act']",
        )}
      >
        <Orb seed={session.id} size={36} className="[grid-area:orb]" />
        <div className="min-w-0 [grid-area:main]">
          <Link
            href={`${ROUTES.interviews}/${session.id}`}
            title={title}
            className="block truncate rounded-sm text-[14px] font-medium text-ink outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ink focus-visible:after:ring-inset focus-visible:after:rounded-[inherit]"
          >
            {title}
          </Link>
          <p className="m-0 mt-0.5 truncate text-[12.5px] text-ink-3">{meta}</p>
        </div>
        <div className="flex items-center gap-2.5 justify-self-start [grid-area:pill] sm:justify-self-end">
          {score ? <span className="text-[12.5px] tabular-nums text-ink-2">{score}</span> : null}
          <StatusPill status={session.status} />
        </div>
        <div className="flex justify-end [grid-area:act]">
          <RowAction session={session} />
        </div>
      </div>
    </li>
  );
}

function SessionGroup({
  title,
  sessions,
  empty,
}: {
  title: string;
  sessions: InterviewSession[];
  empty: { title: string; hint: string };
}) {
  const n = sessions.length;
  return (
    <section aria-label={title}>
      <SectionHeader
        title={
          <>
            {title}{" "}
            <span className="ml-1 text-ink-3">
              <Count n={n} label={`${n} ${n === 1 ? "session" : "sessions"}`} />
            </span>
          </>
        }
      />
      {n === 0 ? (
        <div className="rounded-tile bg-surface">
          <EmptyState title={empty.title} hint={empty.hint} className="py-10" />
        </div>
      ) : (
        <ul className="m-0 list-none overflow-hidden rounded-tile bg-background p-0 shadow-ring">
          {sessions.map((session) => (
            <SessionRow key={session.id} session={session} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** The candidate's sessions, split into what's coming up and what's done. */
export function SessionsList() {
  const { data, isLoading, isError } = useMySessions();

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading your interviews">
        <Skeleton className="h-[220px] w-full rounded-tile" />
        <Skeleton className="h-[120px] w-full rounded-tile" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-tile bg-surface px-5 py-6">
        <p role="alert" className="m-0 text-sm text-destructive">
          Couldn&apos;t load your interviews. Refresh the page to try again.
        </p>
      </div>
    );
  }

  const { upcoming, past } = partitionSessions(data.sessions);

  return (
    <div className="flex flex-col gap-10">
      <SessionGroup
        title="Upcoming"
        sessions={upcoming}
        empty={
          data.sessions.length === 0
            ? { title: "No interviews yet", hint: "Book your first round and it shows up here while we prepare your interviewer." }
            : { title: "Nothing booked", hint: "Book another round when you're ready." }
        }
      />
      <SessionGroup
        title="Past"
        sessions={past}
        empty={{ title: "No finished rounds yet", hint: "Rounds you finish land here, each with its debrief." }}
      />
    </div>
  );
}
