"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Count, HudCard, HudEmpty } from "@/components/hud";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
import { RetryPrepButton } from "./RetryPrepButton";
import { StatusPill } from "./StatusPill";

/** The one action a row offers, keyed on status: join, rejoin, retry prep, or open the debrief. */
function RowAction({ session }: { session: InterviewSession }) {
  const base = `${ROUTES.interviews}/${session.id}`;

  switch (session.status) {
    case "PREP_READY":
      return session.liveAvailable ? (
        <Button asChild size="sm" className="relative z-10 h-8 px-3.5">
          <Link href={`${base}/live`}>Join</Link>
        </Button>
      ) : (
        <Button size="sm" variant="outline" disabled className="relative z-10 h-8 px-3.5" title="Live sessions open soon">
          Ready
        </Button>
      );
    case "LIVE_IN_PROGRESS":
      return (
        <Button asChild size="sm" className="relative z-10 h-8 px-3.5">
          <Link href={`${base}/live`}>Rejoin</Link>
        </Button>
      );
    case "PREP_FAILED":
      return <RetryPrepButton session={session} label="Retry" size="sm" variant="outline" className="relative z-10 h-8 px-3" />;
    case "COMPLETED":
    case "ABORTED_TECHNICAL":
      return (
        <Button asChild size="sm" variant="strong" className="relative z-10 h-8 px-3">
          <Link href={`${base}/report`}>Debrief</Link>
        </Button>
      );
    default:
      return <ChevronRight aria-hidden className="h-4 w-4 text-faint" />;
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

  return (
    <li className="border-b border-line last:border-b-0">
      <div
        className={cn(
          "relative grid items-center gap-x-3 gap-y-2 px-4 py-3.5 transition-colors hover:bg-accent has-[a:focus-visible]:bg-accent sm:gap-x-4 sm:px-5",
          "grid-cols-[minmax(0,1fr)_auto] [grid-template-areas:'main_act'_'pill_act']",
          "sm:grid-cols-[minmax(0,1fr)_auto_minmax(88px,auto)] sm:[grid-template-areas:'main_pill_act']",
        )}
      >
        <div className="min-w-0 [grid-area:main]">
          <Link
            href={`${ROUTES.interviews}/${session.id}`}
            className="block truncate text-sm text-foreground after:absolute after:inset-0 focus-visible:outline-none"
          >
            {title}
          </Link>
          <p className="m-0 mt-0.5 truncate font-mono text-[11.5px] text-faint">{meta}</p>
        </div>
        <div className="justify-self-start [grid-area:pill] sm:justify-self-end">
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
    <HudCard title={title} meta={<Count n={n} label={`${n} ${n === 1 ? "session" : "sessions"}`} />}>
      {sessions.length === 0 ? (
        <HudEmpty title={empty.title} hint={empty.hint} />
      ) : (
        <ul className="m-0 list-none p-0">
          {sessions.map((session) => (
            <SessionRow key={session.id} session={session} />
          ))}
        </ul>
      )}
    </HudCard>
  );
}

/** The candidate's sessions, split into what's coming up and what's done. */
export function SessionsList() {
  const { data, isLoading, isError } = useMySessions();

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading your interviews">
        <Skeleton className="h-[220px] w-full rounded-[14px]" />
        <Skeleton className="h-[120px] w-full rounded-[14px]" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-[14px] border border-line-2 px-4 py-6 sm:px-5">
        <p role="alert" className="m-0 text-sm text-destructive">
          Couldn&apos;t load your interviews. Refresh the page to try again.
        </p>
      </div>
    );
  }

  const { upcoming, past } = partitionSessions(data.sessions);

  return (
    <div className="flex flex-col gap-3">
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
