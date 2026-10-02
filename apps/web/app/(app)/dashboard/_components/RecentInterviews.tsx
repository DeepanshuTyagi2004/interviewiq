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
}

/** Finished rounds with a link to each debrief. Scores stay "—" until the scoring contract lands. */
export function RecentInterviews({ sessions, isLoading, isError }: RecentInterviewsProps) {
  return (
    <HudCard
      title="Recent interviews"
      meta={
        sessions.length > 0 ? (
          <Count n={sessions.length} label={`${sessions.length} ${sessions.length === 1 ? "interview" : "interviews"}`} />
        ) : undefined
      }
      action={
        <Link
          href={ROUTES.interviews}
          className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          All interviews
          <ArrowRight aria-hidden className="h-3.5 w-3.5" />
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
                className="grid grid-cols-[28px_minmax(0,1fr)_auto_28px] items-center gap-4 px-4 py-3.5 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none sm:px-5"
              >
                <span aria-hidden className="font-mono text-[11px] tabular-nums text-faint">
                  {padCount(i + 1)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm">
                    {ROUND_LABEL.get(s.roundType) ?? s.roundType} · {s.companyName ?? s.company}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[11.5px] text-faint">
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
