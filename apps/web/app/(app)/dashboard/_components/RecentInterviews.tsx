import Link from "next/link";
import { MonoPill } from "@/components/patterns";
import { Skeleton } from "@/components/ui/skeleton";
import { ROUND_OPTIONS } from "@/lib/constants/interview";
import { ROUTES } from "@/lib/constants/shared";
import type { InterviewSession } from "@/features/interview";
import { formatDate } from "@/lib/utils/format";
import { ListCard, ListEmpty } from "./ListCard";

const ROUND_LABEL = new Map(ROUND_OPTIONS.map((r) => [r.value, r.label]));

export interface RecentInterviewsProps {
  sessions: InterviewSession[];
  isLoading: boolean;
  isError: boolean;
}

/** Finished rounds with a link to each debrief. Scores stay "—" until the scoring contract lands. */
export function RecentInterviews({ sessions, isLoading, isError }: RecentInterviewsProps) {
  return (
    <ListCard title="Recent interviews" action={{ label: "All interviews", href: ROUTES.interviews }}>
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
        <ListEmpty title="No interviews taken yet" hint="Every round you finish shows up here with its debrief." />
      ) : (
        <ul className="m-0 list-none p-0">
          {sessions.map((s) => (
            <li key={s.id} className="border-b border-line last:border-b-0">
              <Link
                href={`${ROUTES.interviews}/${s.id}/report`}
                className="grid grid-cols-[minmax(0,1fr)_auto_28px] items-center gap-4 px-4 py-3.5 transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none sm:px-5"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm">
                    {ROUND_LABEL.get(s.roundType) ?? s.roundType} · {s.companyName ?? s.company}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-faint">
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
    </ListCard>
  );
}
