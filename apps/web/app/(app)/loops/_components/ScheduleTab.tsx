"use client";

import { useState } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Count, EmptyState as DsEmptyState, Orb, SectionHeader } from "@/components/ds";
import { EmptyState } from "@/components/patterns";
import { StatusPill } from "@/app/(app)/interviews/_components/StatusPill";
import { useMySessions, type InterviewSession } from "@/features/interview";
import { companyLabel, formatSlot, partitionSessions, roundLabel } from "@/features/interview/presentation";
import { useLoops } from "@/features/loops";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { RescheduleDialog, useCancelWithToast } from "@/features/loops/components/SlotDialog";
import { ROUTES } from "@/lib/constants/shared";
import { loopHref } from "./loopUi";

const MOVABLE = new Set(["SCHEDULED", "PREP_READY", "PREP_FAILED"]);

function Row({ s, loopTitle, onMove }: { s: InterviewSession; loopTitle: string | null; onMove: (s: InterviewSession) => void }) {
  const { cancel, pending, confirmation } = useCancelWithToast();
  const { canInterview } = useCurrentUser();
  const movable = MOVABLE.has(s.status);
  const round = roundLabel(s.roundType);
  const company = companyLabel(s);
  return (
    <TableRow>
      <TableCell className="px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Orb seed={s.id} size={34} />
          <div className="min-w-0">
            <span className="block max-w-[260px] truncate font-medium" title={`${round} · ${company}`}>{round}</span>
            <small className="block max-w-[260px] truncate text-[12.5px] text-ink-3">{company}</small>
          </div>
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap text-ink-2">{formatSlot(s.scheduledAt)}</TableCell>
      <TableCell className="text-ink-2">
        {s.loopId && loopTitle ? (
          <Link href={loopHref(s.loopId)} title={loopTitle} className="block max-w-[200px] truncate rounded-sm underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ink">{loopTitle}</Link>
        ) : (
          <span className="text-ink-3">Ad-hoc</span>
        )}
      </TableCell>
      <TableCell><StatusPill status={s.status} /></TableCell>
      <TableCell className="pr-5">
        {confirmation}
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {s.status === "PREP_READY" || s.status === "LIVE_IN_PROGRESS" ? (
            <Button asChild size="sm"><Link href={`${ROUTES.interviews}/${s.id}`}>{s.status === "PREP_READY" ? "Join" : "Rejoin"}</Link></Button>
          ) : null}
          {s.status === "COMPLETED" || s.status === "ABORTED_TECHNICAL" ? (
            <Button asChild size="sm" variant="outline"><Link href={`${ROUTES.interviews}/${s.id}/report`}>Debrief</Link></Button>
          ) : null}
          {movable && canInterview ? <Button size="sm" variant="ghost" onClick={() => onMove(s)}>Reschedule</Button> : null}
          {movable ? <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={pending} onClick={() => cancel(s.id)}>Cancel</Button> : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

function SessionTable({ label, rows, loopTitle, onMove }: { label: string; rows: InterviewSession[]; loopTitle: Map<string, string>; onMove: (s: InterviewSession) => void }) {
  return (
    <Table className="min-w-[760px]" aria-label={label}>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="px-5">Round</TableHead>
          <TableHead>When</TableHead>
          <TableHead>Track</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="pr-5 text-right"><span className="sr-only">Actions</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((s) => <Row key={s.id} s={s} loopTitle={s.loopId ? (loopTitle.get(s.loopId) ?? null) : null} onMove={onMove} />)}
      </TableBody>
    </Table>
  );
}

/** Every interview across companies in one place; no two share a slot. */
export function ScheduleTab() {
  const sessions = useMySessions();
  const loops = useLoops();
  const [moving, setMoving] = useState<InterviewSession | null>(null);

  if (sessions.isLoading) return <div className="flex flex-col gap-2 rounded-tile p-4 shadow-ring" aria-busy="true" aria-label="Loading schedule">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  if (sessions.isError) return <EmptyState title="Couldn't load your interviews" action={<Button variant="outline" size="sm" onClick={() => void sessions.refetch()}>Try again</Button>} />;
  const { upcoming, past } = partitionSessions(sessions.data?.sessions ?? []);
  const loopTitle = new Map((loops.data ?? []).map((l) => [l.id, l.jd ? `${l.jd.companyName} track` : l.name]));

  return (
    <div className="flex flex-col gap-10">
      <section aria-label="Upcoming">
        <SectionHeader title={<>Upcoming <span className="ml-1 text-ink-3"><Count n={upcoming.length} label={`${upcoming.length} upcoming`} /></span></>} />
        {upcoming.length === 0 ? (
          <div className="rounded-tile bg-surface">
            <DsEmptyState title="Nothing booked" hint="Book a round from one of your tracks. Slots that clash with another interview are greyed out.">
              <Button asChild variant="outline" size="sm"><Link href={ROUTES.loops}>Go to tracks</Link></Button>
            </DsEmptyState>
          </div>
        ) : (
          <SessionTable label="Upcoming interviews" rows={upcoming} loopTitle={loopTitle} onMove={setMoving} />
        )}
      </section>
      {past.length > 0 ? (
        <section aria-label="Past and cancelled">
          <SectionHeader title={<>Past and cancelled <span className="ml-1 text-ink-3"><Count n={past.length} label={`${past.length} past`} /></span></>} />
          <SessionTable label="Past and cancelled interviews" rows={past} loopTitle={loopTitle} onMove={setMoving} />
        </section>
      ) : null}
      <RescheduleDialog session={moving} onOpenChange={(o) => { if (!o) setMoving(null); }} />
    </div>
  );
}
