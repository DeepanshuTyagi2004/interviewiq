"use client";

import { useMySessions } from "@/features/interview";
import { useLoops } from "@/features/loops";
import { ROUTES } from "@/lib/constants/shared";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { CalendarCard } from "./CalendarCard";
import { CompaniesCarousel } from "./CompaniesCarousel";
import { Greeting } from "./Greeting";
import { QuickTiles } from "./QuickTiles";
import { ReadinessCard } from "./ReadinessCard";
import { RecentInterviews } from "./RecentInterviews";
import { recentSessions, sessionHref, upcomingSessions } from "./sessions";
import { UpNextCard } from "./UpNextCard";
import { WeekAgenda } from "./WeekAgenda";
import { isJoinable } from "@/features/interview/presentation";

/**
 * Signed-in home: header, quick-start tiles, up next beside readiness, then the calendar beside
 * this week and recent results, and the researched processes. Sections are spaced to breathe and
 * the page scrolls; nothing is squeezed to fit one window. The app shell supplies the page width.
 */
export function Dashboard() {
  const { user, interviewBlocked } = useCurrentUser();
  const sessions = useMySessions();
  const loops = useLoops();

  // Cancelled interviews no longer hold a slot: keep them off the calendar and out of "up next".
  const all = (sessions.data?.sessions ?? []).filter((s) => s.status !== "CANCELLED");
  const next = upcomingSessions(all, 1)[0];
  const recent = recentSessions(all);

  // With nothing booked, point at the loop that has a round ready to book.
  const ready = (loops.data ?? []).find((l) => l.status === "active" && l.progress.nextNodeIds.length > 0);

  return (
    <div className="flex min-w-0 flex-col gap-9">
      <Greeting
        name={user?.name}
        // Viewing a booked round is fine; booking or joining needs interview access.
        actionBlocked={interviewBlocked && !(next && !isJoinable(next))}
        roomHref={next ? sessionHref(next) : ready ? `${ROUTES.loops}/${ready.id}` : ROUTES.interviews}
        roomLabel={
          next
            ? isJoinable(next)
              ? "Enter interview room"
              : "View your round"
            : ready
              ? "Book your next round"
              : "Schedule a round"
        }
      />

      <QuickTiles />

      <div className="grid grid-cols-1 gap-x-5 gap-y-9 lg:grid-cols-[1.25fr_1fr]">
        <UpNextCard session={next} />
        <ReadinessCard />
      </div>

      <div className="grid grid-cols-1 gap-x-5 gap-y-9 lg:grid-cols-[1.25fr_1fr] lg:items-start">
        <CalendarCard sessions={all} />
        <div className="flex flex-col gap-9">
          <WeekAgenda sessions={all} />
          <RecentInterviews sessions={recent} isLoading={sessions.isLoading} isError={sessions.isError} />
        </div>
      </div>

      <CompaniesCarousel />
    </div>
  );
}
