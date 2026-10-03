"use client";

import { useMySessions } from "@/features/interview";
import { useLoops } from "@/features/loops";
import { ROUND_OPTIONS } from "@/lib/constants/interview";
import { ROUTES } from "@/lib/constants/shared";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { CalendarCard } from "./CalendarCard";
import { Greeting } from "./Greeting";
import { LeaderboardCard } from "./LeaderboardCard";
import { ReadinessCard } from "./ReadinessCard";
import { RecentInterviews } from "./RecentInterviews";
import { InterviewScoreCard, RanksCard } from "./ScoreTiles";
import { formatSlot, recentSessions, sessionHref, upcomingSessions } from "./sessions";
import { UpNextCard } from "./UpNextCard";

const ROUND_LABEL = new Map(ROUND_OPTIONS.map((r) => [r.value, r.label]));

/**
 * Signed-in home. From lg up it fits the viewport with no scrolling: three columns (up next,
 * score, recent | the calendar | readiness, ranks, leaderboard) whose rows share the height, and
 * every size follows `--u`, which `.iq-fit` scales to the room available. Narrower screens stack
 * the cards and scroll.
 */
export function Dashboard() {
  const { user } = useCurrentUser();
  const sessions = useMySessions();

  const loops = useLoops();

  // Cancelled interviews no longer hold a slot: keep them off the calendar and out of "up next".
  const all = (sessions.data?.sessions ?? []).filter((s) => s.status !== "CANCELLED");
  const next = upcomingSessions(all, 1)[0];
  const recent = recentSessions(all);

  // With nothing booked, point at the loop that has a round ready to book.
  const ready = (loops.data ?? []).find((l) => l.status === "active" && l.progress.nextNodeIds.length > 0);
  const summary = next
    ? `Your ${next.companyName ?? next.company} ${ROUND_LABEL.get(next.roundType) ?? next.roundType} round is ${
        next.status === "PREP_READY" ? "ready to join" : `booked for ${formatSlot(next.scheduledAt)}`
      }.`
    : ready
      ? `Your ${ready.jd?.companyName ?? "interview"} track has a round ready to book.`
      : "Pick a company and role to start practising its real process.";

  return (
    <div className="iq-fit mx-auto flex w-full max-w-[1760px] flex-none flex-col lg:min-h-0 lg:flex-1">
      <div className="flex flex-col px-[calc(16*var(--u))] pb-[calc(24*var(--u))] pt-[calc(26*var(--u))] sm:px-[calc(26*var(--u))] lg:h-full lg:min-h-0">
        <Greeting name={user?.name} summary={summary} roomHref={next ? sessionHref(next) : ready ? `${ROUTES.loops}/${ready.id}` : ROUTES.interviews} />

        <div className="mt-[calc(30*var(--u))] grid grid-cols-1 gap-[calc(20*var(--u))] md:grid-cols-2 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.73fr)_minmax(0,1fr)] lg:grid-rows-[minmax(min-content,1.1fr)_auto_minmax(0,1fr)]">
          <UpNextCard session={next} className="lg:col-start-1 lg:row-start-1" />
          <ReadinessCard className="lg:col-start-3 lg:row-start-1" />
          {/* Size containment on lg: the calendar fills whatever its three rows come to, instead of
              its content deciding how tall the first row must be. */}
          <CalendarCard
            sessions={all}
            className="md:col-span-2 lg:col-span-1 lg:col-start-2 lg:row-span-3 lg:row-start-1 lg:[contain:size]"
          />
          <InterviewScoreCard className="lg:col-start-1 lg:row-start-2" />
          <RanksCard className="lg:col-start-3 lg:row-start-2" />
          <RecentInterviews
            sessions={recent}
            isLoading={sessions.isLoading}
            isError={sessions.isError}
            className="lg:col-start-1 lg:row-start-3 lg:min-h-0"
          />
          <LeaderboardCard className="lg:col-start-3 lg:row-start-3 lg:min-h-0" />
        </div>
      </div>
    </div>
  );
}
