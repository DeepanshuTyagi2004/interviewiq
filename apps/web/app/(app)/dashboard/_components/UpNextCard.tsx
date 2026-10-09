import { ArrowRight } from "lucide-react";
import { HudCard, StatusDot } from "@/components/hud";
import { ROUND_OPTIONS } from "@/lib/constants/interview";
import { ROUTES } from "@/lib/constants/shared";
import type { InterviewSession } from "@/features/interview";
import { isJoinable } from "@/features/interview/presentation";
import { statusDotState } from "@/app/(app)/interviews/_components/StatusPill";
import { formatSlot, sessionHref, shortDate } from "./sessions";
import { levelLabel } from "@/lib/constants/engineering-levels";
import { RoomLink } from "@/features/interview-live/RoomLink";

const ROUND_LABEL = new Map(ROUND_OPTIONS.map((r) => [r.value, r.label]));

function statusLabel(session: InterviewSession): string {
  switch (session.status) {
    case "PREP_READY":
      return session.liveAvailable ? "READY TO JOIN" : "READY";
    case "LIVE_IN_PROGRESS":
      return "LIVE NOW";
    case "PREP_QUEUED":
      return "PREPARING";
    case "PREP_FAILED":
      return "PREP FAILED";
    default:
      return `BOOKED · ${shortDate(session.scheduledAt)}`;
  }
}

/** One cell of the readout strip on the dark card (white opacities: the card is dark in both themes). */
function ReadoutCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 flex-[1_1_96px] bg-inv px-[calc(12*var(--u))] py-[calc(8*var(--u))]">
      <dt className="font-mono text-[length:calc(10.5*var(--u))] uppercase tracking-[0.14em] text-white/50">{label}</dt>
      <dd className="m-0 mt-0.5 text-[length:calc(14*var(--u))] leading-snug text-white/90">{children}</dd>
    </div>
  );
}

/**
 * The next round, on the design's dark "up next" card: company + level, round, slot and one
 * action. Without a booked round it points at the company library instead. The status dot uses
 * the interviews list's mapping: it pulses only while prep or the round is actually running.
 * Sizes follow `--u` (the dashboard fits the viewport).
 */
export function UpNextCard({ session, className }: { session: InterviewSession | undefined; className?: string }) {
  const joinable = session ? isJoinable(session) : false;
  const round = session ? (ROUND_LABEL.get(session.roundType) ?? session.roundType) : null;
  const company = session ? (session.companyName ?? session.company) : null;

  return (
    <HudCard
      tone="inverse"
      notch
      glow="br"
      aria-label="Up next"
      title={session ? `Up next · ${company} ${levelLabel(session.level)}` : "Up next"}
      meta={
        session ? (
          <StatusDot state={statusDotState(session.status)} label={statusLabel(session)} className="text-white" />
        ) : undefined
      }
      className={className}
      bodyClassName="flex flex-col gap-[calc(16*var(--u))] px-[calc(18*var(--u))] py-[calc(24*var(--u))] sm:px-[calc(26*var(--u))]"
    >
      <h3 className="m-0 text-[length:calc(34*var(--u))] font-normal leading-[1.1] tracking-[-0.035em]">
        {round ?? "No round booked yet"}
      </h3>
      <p className="m-0 line-clamp-2 max-w-[520px] text-[length:calc(16*var(--u))] leading-[1.55] text-white/80">
        {session
          ? `${company} · ${session.role}. Your interviewer prepares from your own resume and projects, and follows the company's real process.`
          : "Pick a company and role to see its real interview process, then book round one."}
      </p>

      <div className="mt-auto flex flex-wrap items-center gap-[calc(12*var(--u))]">
        {session ? (
          <dl className="m-0 flex min-w-0 flex-[1_1_100%] flex-wrap gap-px overflow-hidden rounded-md border border-white/10 bg-white/10">
            <ReadoutCell label="Slot">{formatSlot(session.scheduledAt)}</ReadoutCell>
            <ReadoutCell label="Level">{levelLabel(session.level)}</ReadoutCell>
            {session.specialization ? <ReadoutCell label="Track">{session.specialization}</ReadoutCell> : null}
          </dl>
        ) : null}
        <RoomLink
          href={session ? sessionHref(session) : ROUTES.jobs}
          className="inline-flex h-[calc(46*var(--u))] items-center gap-[calc(8*var(--u))] rounded-full bg-brand px-[calc(22*var(--u))] text-[length:calc(16*var(--u))] text-brand-foreground transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
        >
          {session ? (joinable ? "Enter room" : "View schedule") : "Browse companies"}
          <ArrowRight aria-hidden className="size-[calc(16*var(--u))]" />
        </RoomLink>
      </div>
    </HudCard>
  );
}
