import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Count, HudCard, HudEmpty, padCount } from "@/components/hud";
import { MonoPill } from "@/components/patterns";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUND_OPTIONS } from "@/lib/constants/interview";
import { ROUTES } from "@/lib/constants/shared";
import type { InterviewSession } from "@/features/interview";
import { formatDate } from "@/lib/utils/format";

const ROUND_LABEL = new Map(ROUND_OPTIONS.map((r) => [r.value, r.label]));

export interface RecentInterviewsProps {
  sessions: InterviewSession[];
  isLoading: boolean;
  isError: boolean;
  className?: string;
}

/**
 * Finished rounds with a link to each debrief. Scores stay "—" until the scoring contract lands.
 * The list scrolls inside the card when the dashboard is fitted to a short viewport.
 */
export function RecentInterviews({ sessions, isLoading, isError, className }: RecentInterviewsProps) {
  return (
    <HudCard
      title="Recent interviews"
      glow="tr"
      className={className}
      bodyClassName="min-h-0 overflow-y-auto"
      meta={
        sessions.length > 0 ? (
          <Count n={sessions.length} label={`${sessions.length} ${sessions.length === 1 ? "interview" : "interviews"}`} />
        ) : undefined
      }
      action={
        <Link
          href={ROUTES.interviews}
          aria-label="All interviews"
          className="inline-flex items-center gap-1 text-[length:calc(16*var(--u))] text-foreground hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          All
          <ArrowRight aria-hidden className="size-[calc(16*var(--u))]" />
        </Link>
      }
    >
      {isLoading ? (
        <div className="flex flex-col gap-2 p-4" aria-busy="true" aria-label="Loading interviews">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      ) : isError ? (
        <p role="alert" className="m-0 px-5 py-6 text-sm text-destructive">
          Couldn&apos;t load your interviews. Refresh to try again.
        </p>
      ) : sessions.length === 0 ? (
        <HudEmpty title="No interviews taken yet" hint="Every round you finish shows up here with its debrief." />
      ) : (
        <ul className="m-0 list-none p-0">
          {sessions.map((s, i) => (
            <li key={s.id} className="border-b border-line last:border-b-0">
              <Link
                href={`${ROUTES.interviews}/${s.id}/report`}
                className="grid grid-cols-[calc(24*var(--u))_minmax(0,1fr)_auto_calc(24*var(--u))] items-center gap-[calc(14*var(--u))] px-[calc(18*var(--u))] py-[calc(13*var(--u))] transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none sm:px-[calc(26*var(--u))]"
              >
                <span aria-hidden className="font-mono text-[length:calc(12*var(--u))] tabular-nums text-faint">
                  {padCount(i + 1)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[length:calc(15.5*var(--u))]">
                    {ROUND_LABEL.get(s.roundType) ?? s.roundType} · {s.companyName ?? s.company}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[length:calc(12*var(--u))] text-faint">
                    {s.level} · {formatDate(s.scheduledAt)}
                  </span>
                </span>
                <MonoPill tone={s.status === "COMPLETED" ? "soft" : "ghost"}>
                  {s.status === "COMPLETED" ? "DONE" : "INTERRUPTED"}
                </MonoPill>
                <span className="text-right font-mono text-sm text-faint">
                  <span aria-hidden>—</span>
                  <span className="sr-only">No score yet</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </HudCard>
  );
}
