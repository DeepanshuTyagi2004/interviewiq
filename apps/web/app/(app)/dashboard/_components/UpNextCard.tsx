import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { HudCard, StatusDot } from "@/components/hud";
import { ROUND_OPTIONS } from "@/lib/constants/interview";
import { ROUTES } from "@/lib/constants/shared";
import type { InterviewSession } from "@/features/interview";
import { isJoinable } from "@/features/interview/presentation";
import { statusDotState } from "@/app/(app)/interviews/_components/StatusPill";
import { formatSlot, sessionHref, shortDate } from "./sessions";

const ROUND_LABEL = new Map(ROUND_OPTIONS.map((r) => [r.value, r.label]));

function statusLabel(session: InterviewSession): string {
  switch (session.status) {
    case "PREP_READY":
      return "READY TO JOIN";
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
    <div className="min-w-0 flex-[1_1_110px] bg-inv px-3 py-2">
      <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-white/50">{label}</dt>
      <dd className="m-0 mt-0.5 text-[13px] leading-snug text-white/90">{children}</dd>
    </div>
  );
}

/**
 * The next round, on the design's dark "up next" card: company + level, round, slot and one
 * action. Without a booked round it points at the company library instead. The status dot uses
 * the interviews list's mapping: it pulses only while prep or the round is actually running.
 */
export function UpNextCard({ session }: { session: InterviewSession | undefined }) {
  const joinable = session ? isJoinable(session) : false;
  const round = session ? (ROUND_LABEL.get(session.roundType) ?? session.roundType) : null;
  const company = session ? (session.companyName ?? session.company) : null;

  return (
    <HudCard
      tone="inverse"
      notch
      aria-label="Up next"
      title={session ? `Up next · ${company} ${session.level}` : "Up next"}
      meta={
        session ? (
          <StatusDot state={statusDotState(session.status)} label={statusLabel(session)} className="text-white" />
        ) : undefined
      }
      className="min-h-[250px] flex-[2_1_420px]"
      bodyClassName="flex flex-col gap-[18px] p-5 sm:p-[26px]"
    >
      <h3 className="m-0 text-[26px] font-normal leading-[1.1] tracking-[-0.035em] sm:text-[30px]">
        {round ?? "No round booked yet"}
      </h3>
      <p className="m-0 max-w-[520px] text-sm leading-[1.5] text-white/80">
        {session
          ? `${company} · ${session.role}. Your interviewer prepares from your own resume and projects, and follows the company's real process.`
          : "Pick a company and role to see its real interview process, then book round one."}
      </p>

      <div className="mt-auto flex flex-wrap items-center gap-3">
        {session ? (
          <dl className="m-0 flex min-w-0 flex-[1_1_280px] flex-wrap gap-px overflow-hidden rounded-md border border-white/10 bg-white/10">
            <ReadoutCell label="Slot">{formatSlot(session.scheduledAt)}</ReadoutCell>
            <ReadoutCell label="Level">{session.level}</ReadoutCell>
            {session.specialization ? <ReadoutCell label="Track">{session.specialization}</ReadoutCell> : null}
          </dl>
        ) : null}
        <Link
          href={session ? sessionHref(session) : ROUTES.jobs}
          className="ml-auto inline-flex h-[38px] items-center gap-1.5 rounded-full bg-brand px-4 text-[13.5px] text-brand-foreground transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
        >
          {session ? (joinable ? "Enter room" : "View schedule") : "Browse companies"}
          <ArrowRight aria-hidden className="h-3.5 w-3.5" />
        </Link>
      </div>
    </HudCard>
  );
}
