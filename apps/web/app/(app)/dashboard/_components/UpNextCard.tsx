"use client";

import Link from "next/link";
import { InterviewAccessNote } from "@/components/auth/InterviewAccessNote";
import { Card, Chip, EmptyState, Orb, SectionHeader } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { ROUND_OPTIONS } from "@/lib/constants/interview";
import { ROUTES } from "@/lib/constants/shared";
import type { InterviewSession } from "@/features/interview";
import { isJoinable, roundLength } from "@/features/interview/presentation";
import { levelLabel } from "@/lib/constants/engineering-levels";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { cn } from "@/lib/utils/cn";
import { RoomLink } from "@/features/interview-live/RoomLink";
import { formatSlot, sessionHref, whenLabel } from "./sessions";

const ROUND_LABEL = new Map(ROUND_OPTIONS.map((r) => [r.value, r.label]));

function statusLabel(session: InterviewSession): string {
  switch (session.status) {
    case "PREP_READY":
      return session.liveAvailable ? "Ready to join" : "Ready";
    case "LIVE_IN_PROGRESS":
      return "Live now";
    case "PREP_QUEUED":
      return "Preparing";
    case "PREP_FAILED":
      return "Prep failed";
    default:
      return "Booked";
  }
}

/**
 * The next round on a stone card with an orb glow: round and status chips, the title, the slot and
 * length, the interviewer, and the actions. Without a booked round it is an empty state that
 * points at scheduling one.
 */
export function UpNextCard({
  session,
  className,
  now = new Date(),
}: {
  session: InterviewSession | undefined;
  className?: string;
  now?: Date;
}) {
  const { canInterview, interviewBlocked } = useCurrentUser();
  if (!session) {
    return (
      <div className={cn("flex flex-col", className)}>
        <SectionHeader title="Up next" />
        <Card tone="stage" aria-label="Up next" className="min-h-[260px] flex-1 justify-center">
          <EmptyState
            title="No round booked yet"
            hint="Pick a company and role to see its real interview process, then book round one."
          >
            {interviewBlocked ? (
              <InterviewAccessNote />
            ) : (
              <Button asChild>
                <Link href={ROUTES.interviews}>Schedule a round</Link>
              </Button>
            )}
          </EmptyState>
        </Card>
      </div>
    );
  }

  const joinable = isJoinable(session);
  const round = ROUND_LABEL.get(session.roundType) ?? session.roundType;
  const company = session.companyName ?? session.company;
  const length = roundLength(session);
  const title = `${company} · ${levelLabel(session.level)} mock process`;
  const interviewer = session.briefing?.interviewerName;
  const reschedule = session.loopId ? `${ROUTES.loops}/${session.loopId}` : null;
  const briefing = `${ROUTES.interviews}/${session.id}`;

  return (
    <div className={cn("flex flex-col", className)}>
      <SectionHeader title="Up next" actions={<Chip>{whenLabel(session.scheduledAt, now)}</Chip>} />
      <Card tone="stage" aria-label="Up next" className="relative min-h-[260px] flex-1 overflow-hidden">
        <Orb
          seed={session.id}
          size={320}
          className="pointer-events-none absolute -right-20 -top-24 opacity-90"
        />
        <div className="relative flex min-w-0 flex-wrap gap-1.5">
          <Chip tone="ink" className="max-w-full truncate" >{round}</Chip>
          <Chip>{statusLabel(session)}</Chip>
        </div>
        <h3
          title={title}
          className="relative m-0 mt-4 line-clamp-2 max-w-[70%] font-display text-[28px] font-normal leading-[1.15] tracking-[-0.03em] max-sm:max-w-full max-sm:text-[24px]"
        >
          {title}
        </h3>
        <div className="relative mt-3 flex flex-wrap gap-x-[18px] gap-y-1 text-[13.5px] text-ink-2">
          <span>{formatSlot(session.scheduledAt)}</span>
          {length ? <span>{length}</span> : null}
          {session.specialization ? <span className="truncate">{session.specialization}</span> : null}
        </div>
        <div className="relative mt-auto flex flex-wrap items-center gap-x-2.5 gap-y-3 pt-[22px]">
          <Orb seed={`${session.id}-interviewer`} size={40} />
          <div className="min-w-0">
            <div className="truncate text-[14px] font-medium">{interviewer ?? "Your interviewer"}</div>
            <small className="block text-[12.5px] text-ink-3">
              {interviewer ? "Your interviewer" : "Introduced in the briefing"}
            </small>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            {joinable && interviewBlocked ? (
              <>
                <Button asChild variant="outline">
                  <Link href={briefing}>Open briefing</Link>
                </Button>
                <InterviewAccessNote />
              </>
            ) : joinable ? (
              <>
                <Button asChild variant="outline">
                  <Link href={briefing}>Open briefing</Link>
                </Button>
                <Button asChild>
                  <RoomLink href={sessionHref(session)}>Enter room</RoomLink>
                </Button>
              </>
            ) : (
              <>
                {reschedule && canInterview ? (
                  <Button asChild variant="outline">
                    <Link href={reschedule}>Reschedule</Link>
                  </Button>
                ) : null}
                <Button asChild>
                  <Link href={briefing}>Open briefing</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
