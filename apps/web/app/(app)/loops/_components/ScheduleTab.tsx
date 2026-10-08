"use client";

import { useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Count, HudCard, HudEmpty } from "@/components/hud";
import { EmptyState } from "@/components/patterns";
import { StatusPill } from "@/app/(app)/interviews/_components/StatusPill";
import { useMySessions, type InterviewSession } from "@/features/interview";
import { companyLabel, formatSlot, partitionSessions, roundLabel } from "@/features/interview/presentation";
import { useLoops } from "@/features/loops";
import { RescheduleDialog, useCancelWithToast } from "@/features/loops/components/SlotDialog";
import { ROUTES } from "@/lib/constants/shared";
import { loopHref } from "./loopUi";

const MOVABLE = new Set(["SCHEDULED", "PREP_READY", "PREP_FAILED"]);

function Row({ s, loopTitle, onMove }: { s: InterviewSession; loopTitle: string | null; onMove: (s: InterviewSession) => void }) {
  const { cancel, pending, confirmation } = useCancelWithToast();
  const movable = MOVABLE.has(s.status);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3.5 last:border-b-0 sm:px-5">
      <div className="min-w-0">
        <p className="m-0 truncate text-sm">{roundLabel(s.roundType)} · {companyLabel(s)}</p>
        <p className="m-0 mt-0.5 truncate font-mono text-[11.5px] text-faint">
          {formatSlot(s.scheduledAt)}
          {s.loopId && loopTitle ? <> · <Link href={loopHref(s.loopId)} className="underline underline-offset-2">{loopTitle}</Link></> : " · ad-hoc"}
        </p>
      </div>
      {confirmation}
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={s.status} />
        {s.status === "PREP_READY" || s.status === "LIVE_IN_PROGRESS" ? (
          <Button asChild size="sm"><Link href={`${ROUTES.interviews}/${s.id}`}>{s.status === "PREP_READY" ? "Join" : "Rejoin"}</Link></Button>
        ) : null}
        {s.status === "COMPLETED" || s.status === "ABORTED_TECHNICAL" ? (
          <Button asChild size="sm" variant="strong"><Link href={`${ROUTES.interviews}/${s.id}/report`}>Debrief</Link></Button>
        ) : null}
        {movable ? <Button size="sm" variant="ghost" onClick={() => onMove(s)}>Reschedule</Button> : null}
        {movable ? <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={pending} onClick={() => cancel(s.id)}>Cancel</Button> : null}
      </div>
    </li>
  );
}

/** Every interview across companies in one place; no two share a slot. */
export function ScheduleTab() {
  const sessions = useMySessions();
  const loops = useLoops();
  const [moving, setMoving] = useState<InterviewSession | null>(null);

  if (sessions.isLoading) return <Skeleton className="h-[240px] rounded-[14px]" />;
  if (sessions.isError) return <EmptyState title="Couldn't load your interviews" action={<Button variant="outline" size="sm" onClick={() => void sessions.refetch()}>Try again</Button>} />;
  const { upcoming, past } = partitionSessions(sessions.data?.sessions ?? []);
  const loopTitle = new Map((loops.data ?? []).map((l) => [l.id, l.jd ? `${l.jd.companyName} track` : l.name]));

  return (
    <div className="flex flex-col gap-3">
      <HudCard title="Upcoming" meta={<Count n={upcoming.length} label={`${upcoming.length} upcoming`} />}>
        {upcoming.length === 0 ? (
          <HudEmpty title="Nothing booked" hint="Book a round from one of your tracks. Slots that clash with another interview are greyed out.">
            <Button asChild size="sm" variant="strong"><Link href={ROUTES.loops}>Go to tracks</Link></Button>
          </HudEmpty>
        ) : (
          <ul className="m-0 list-none p-0">{upcoming.map((s) => <Row key={s.id} s={s} loopTitle={s.loopId ? (loopTitle.get(s.loopId) ?? null) : null} onMove={setMoving} />)}</ul>
        )}
      </HudCard>
      {past.length > 0 ? (
        <HudCard title="Past and cancelled" meta={<Count n={past.length} label={`${past.length} past`} />}>
          <ul className="m-0 list-none p-0">{past.map((s) => <Row key={s.id} s={s} loopTitle={s.loopId ? (loopTitle.get(s.loopId) ?? null) : null} onMove={setMoving} />)}</ul>
        </HudCard>
      ) : null}
      <RescheduleDialog session={moving} onOpenChange={(o) => { if (!o) setMoving(null); }} />
    </div>
  );
}
