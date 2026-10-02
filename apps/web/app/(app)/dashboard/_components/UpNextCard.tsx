import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ROUND_OPTIONS } from "@/lib/constants/interview";
import { ROUTES } from "@/lib/constants/shared";
import type { InterviewSession } from "@/features/interview";
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

/** Chip on the dark card — fixed colours because the card is dark in both themes. */
function Chip({ children }: { children: React.ReactNode }) {
  return <li className="rounded-full border border-[#3a3a37] px-2.5 py-[5px] text-xs text-[#dcdbd6]">{children}</li>;
}

/**
 * The next round, on the design's dark "up next" card: company + level, round, slot and one
 * action. Without a booked round it points at the company library instead.
 */
export function UpNextCard({ session }: { session: InterviewSession | undefined }) {
  const joinable = session?.status === "PREP_READY" || session?.status === "LIVE_IN_PROGRESS";
  const round = session ? (ROUND_LABEL.get(session.roundType) ?? session.roundType) : null;
  const company = session ? (session.companyName ?? session.company) : null;

  return (
    <section
      aria-label="Up next"
      className="flex min-h-[250px] min-w-0 flex-[2_1_420px] flex-col gap-[18px] rounded-[14px] bg-inv p-5 text-white sm:p-[26px]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-[#9d9c97]">
        <span>{session ? `Up next · ${company} ${session.level}` : "Up next"}</span>
        {session ? (
          <span className="flex items-center gap-1.5 text-white">
            <span aria-hidden data-motion className="h-1.5 w-1.5 animate-[iq-breathe_1.4s_ease-in-out_infinite] rounded-full bg-brand" />
            {statusLabel(session)}
          </span>
        ) : null}
      </div>

      <h2 className="m-0 text-[26px] font-normal leading-[1.1] tracking-[-0.035em] sm:text-[30px]">
        {round ?? "No round booked yet"}
      </h2>
      <p className="m-0 max-w-[520px] text-sm leading-[1.5] text-[#c9c8c3]">
        {session
          ? `${company} · ${session.role}. Your interviewer prepares from your own resume and projects, and follows the company's real process.`
          : "Pick a company and role to see its real interview process, then book round one."}
      </p>

      <div className="mt-auto flex flex-wrap items-center gap-2">
        {session ? (
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            <Chip>{formatSlot(session.scheduledAt)}</Chip>
            <Chip>{session.level}</Chip>
            {session.specialization ? <Chip>{session.specialization}</Chip> : null}
          </ul>
        ) : null}
        <Link
          href={session ? sessionHref(session) : ROUTES.jobs}
          className="ml-auto inline-flex h-[38px] items-center gap-1.5 rounded-full bg-brand px-4 text-[13.5px] text-brand-foreground transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
        >
          {session ? (joinable ? "Enter room" : "View schedule") : "Browse companies"}
          <ArrowRight aria-hidden className="h-3.5 w-3.5" />
        </Link>
      </div>
    </section>
  );
}
