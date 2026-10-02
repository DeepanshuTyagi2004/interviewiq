"use client";

import { useMySessions } from "@/features/interview";
import { ROUND_OPTIONS } from "@/lib/constants/interview";
import { ROUTES } from "@/lib/constants/shared";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { Greeting } from "./Greeting";
import { LeaderboardCard } from "./LeaderboardCard";
import { ReadinessCard } from "./ReadinessCard";
import { RecentInterviews } from "./RecentInterviews";
import { ScoreTiles } from "./ScoreTiles";
import { formatSlot, recentSessions, sessionHref, upcomingSessions } from "./sessions";
import { UpNextCard } from "./UpNextCard";
import { PAGE_SCAFFOLD } from "@/components/layout/page";

const ROUND_LABEL = new Map(ROUND_OPTIONS.map((r) => [r.value, r.label]));

/** Signed-in home, laid out like the design: greeting, up next + readiness, scores, lists. */
export function Dashboard() {
  const { user } = useCurrentUser();
  const sessions = useMySessions();

  const all = sessions.data?.sessions ?? [];
  const next = upcomingSessions(all, 1)[0];
  const recent = recentSessions(all);

  const summary = next
    ? `Your ${next.companyName ?? next.company} ${ROUND_LABEL.get(next.roundType) ?? next.roundType} round is ${
        next.status === "PREP_READY" ? "ready to join" : `booked for ${formatSlot(next.scheduledAt)}`
      }.`
    : "Pick a company and role to start practising its real process.";

  return (
    <div className={PAGE_SCAFFOLD}>
      <Greeting name={user?.name} summary={summary} roomHref={next ? sessionHref(next) : ROUTES.interviews} />

      <div className="mt-5 flex flex-wrap gap-3">
        <UpNextCard session={next} />
        <ReadinessCard />
      </div>

      <div className="mt-3">
        <ScoreTiles />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <RecentInterviews sessions={recent} isLoading={sessions.isLoading} isError={sessions.isError} />
        <LeaderboardCard />
      </div>
    </div>
  );
}
