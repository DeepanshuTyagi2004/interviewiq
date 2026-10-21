"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useBreadcrumbNames } from "@/components/layout/app-shell/Breadcrumbs";
import { Card, Count, Orb, SectionHeader, SegmentBar } from "@/components/ds";
import { EmptyState } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusPill } from "@/app/(app)/interviews/_components/StatusPill";
import { useMySessions } from "@/features/interview";
import { formatSlot } from "@/features/interview/presentation";
import { readinessLine, useLoop, useSetLoopStatus } from "@/features/loops";
import { scoreChipText } from "@/features/report/presentation";
import { FlowCanvas } from "@/features/loops/components/FlowCanvas";
import { useCurrentUser } from "@/lib/hooks/useCurrentUser";
import { BookRoundDialog, RescheduleDialog, useCancelWithToast } from "@/features/loops/components/SlotDialog";
import { ApiFetchError } from "@/lib/api-client/errors";
import { ROUTES } from "@/lib/constants/shared";
import { levelLabel } from "@/lib/constants/engineering-levels";
import { KindPill, LoopStatusPill } from "./loopUi";

const MOVABLE = new Set(["SCHEDULED", "PREP_READY", "PREP_FAILED"]);

/** `/loops/[loopId]`: one track's flow with per-round state, booking, and its interviews. */
export function LoopDetail({ loopId }: { loopId: string }) {
  const loop = useLoop(loopId);
  useBreadcrumbNames({ track: loop.data?.jd ? `${loop.data.jd.companyName} · ${loop.data.jd.title}` : loop.data?.name });
  const mySessions = useMySessions();
  const { canInterview, interviewBlocked } = useCurrentUser();
  const setStatus = useSetLoopStatus();
  const { cancel, pending: cancelling, confirmation: cancelConfirmation } = useCancelWithToast();
  const [booking, setBooking] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [abandoning, setAbandoning] = useState(false);

  if (loop.isLoading) return <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading track"><Skeleton className="h-[120px] rounded-card" /><Skeleton className="h-[420px] rounded-card" /></div>;
  if (loop.isError || !loop.data) {
    const missing = loop.error instanceof ApiFetchError && loop.error.status === 404;
    return (
      <div className="rounded-tile bg-surface">
        <EmptyState
          title={missing ? "This track doesn't exist" : "Couldn't load this track"}
          action={<Button asChild variant="outline" size="sm"><Link href={ROUTES.loops}>Back to My tracks</Link></Button>}
        />
      </div>
    );
  }

  const l = loop.data;
  const { total, completed } = l.progress;
  const readiness = readinessLine(l);
  const live = l.status === "active" || l.status === "paused";
  const byId = new Map((mySessions.data?.sessions ?? []).map((s) => [s.id, s]));
  const nodeName = (id: string | null) => l.graph.nodes.find((n) => n.id === id)?.name ?? "Round";
  const rows = [...l.sessions].sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  const movingSession = moving ? byId.get(moving) ?? null : null;
  const title = l.jd ? l.jd.title : l.name;
  const sub = l.jd ? `${l.jd.companyName} · ${levelLabel(l.level ?? l.jd.level)}` : [l.level ? levelLabel(l.level) : "Choose a level", "Standalone practice"].join(" · ");

  function change(status: "active" | "paused" | "abandoned") {
    setStatus.mutate({ id: l.id, status }, { onError: (err) => toast.error(err instanceof ApiFetchError && err.code === "loop_exists" ? "You already have another active track for this role." : "Couldn't update the track.") });
  }

  return (
    <div className="flex min-w-0 flex-col">
      <header className="flex flex-wrap items-start justify-between gap-x-5 gap-y-4">
        <div className="flex min-w-0 items-center gap-4">
          <Orb seed={l.jd?.company ?? l.id} size={56} />
          <div className="min-w-0">
            <h1 className="m-0 font-display text-[28px] font-light leading-[1.1] tracking-[-0.035em] sm:text-[34px]" title={title}>
              <span className="line-clamp-2 break-words">{title}</span>
            </h1>
            <p className="m-0 mt-1.5 truncate text-[14px] text-ink-3" title={sub}>
              {l.jd ? <Link href={`${ROUTES.jobs}/${l.jd.jdId}`} className="rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ink">{sub}</Link> : sub}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-1.5"><LoopStatusPill status={l.status} /><KindPill loop={l} /></div>
          </div>
        </div>
        {live ? (
          <div className="flex flex-wrap gap-2">
            {l.status === "active" ? <Button variant="outline" disabled={setStatus.isPending} onClick={() => change("paused")}>Pause</Button> : <Button disabled={setStatus.isPending} onClick={() => change("active")}>Resume</Button>}
            <Button variant="ghost" className="text-destructive hover:text-destructive" disabled={setStatus.isPending} onClick={() => setAbandoning(true)}>Abandon</Button>
          </div>
        ) : null}
      </header>

      <Card tone="surface" aria-label="Progress" className="mt-8">
        <p className="m-0 font-display text-[28px] font-light tracking-[-0.03em] tabular-nums">
          {completed} <span className="text-ink-3">of {total} rounds completed</span>
        </p>
        <SegmentBar segments={Math.max(total, 1)} filled={completed} size="lg" className="mt-4" label={`${completed} of ${total} rounds completed`} />
        {readiness ? <p className="m-0 mt-3 text-[13px] text-ink-2">{readiness}</p> : null}
      </Card>

      <Card
        title="Flow"
        meta={l.status === "paused" ? "Paused: resume to book" : "Click “Book this round” on a ready round"}
        className="mt-10"
        bodyClassName="flex flex-col"
      >
        <FlowCanvas
          graph={l.graph}
          mode="view"
          nodeStates={l.nodeStates}
          nodeResults={l.nodeResults}
          onBookNode={l.status === "active" ? setBooking : undefined}
          bookBlocked={interviewBlocked}
        />
        <p className="m-0 mt-3 text-[12.5px] leading-[1.5] text-ink-3">
          A round unlocks once every round leading into it is completed.{" "}
          {l.countsTowardReadiness
            ? "This is the unedited process, so completed rounds count towards your readiness for this role."
            : "This is standalone practice: it gets full analysis but isn't counted towards readiness."}
        </p>
      </Card>

      <section aria-label="Interviews in this track" className="mt-10">
        <SectionHeader title={<>Interviews in this track <span className="ml-1 text-ink-3"><Count n={rows.length} label={`${rows.length} interviews`} /></span></>} />
        {rows.length === 0 ? (
          <div className="rounded-tile bg-surface">
            <p className="m-0 px-5 py-8 text-center text-sm text-ink-3">Nothing booked yet. Book the first ready round above.</p>
          </div>
        ) : (
          <Table className="min-w-[720px]" aria-label="Interviews in this track">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-5">Round</TableHead>
                <TableHead>When</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-5 text-right"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => {
                const score = scoreChipText(s.score, s.passMark);
                const name = nodeName(s.nodeId);
                return (
                  <TableRow key={s.id}>
                    <TableCell className="px-5"><span className="block max-w-[260px] truncate font-medium" title={name}>{name}</span></TableCell>
                    <TableCell className="whitespace-nowrap text-ink-2">{formatSlot(s.scheduledAt)}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums text-ink-2">{score ?? <><span aria-hidden className="text-ink-3">—</span><span className="sr-only">No score</span></>}</TableCell>
                    <TableCell><StatusPill status={s.status} /></TableCell>
                    <TableCell className="pr-5">
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {s.status === "PREP_READY" || s.status === "LIVE_IN_PROGRESS" ? <Button asChild size="sm"><Link href={`${ROUTES.interviews}/${s.id}`}>{s.status === "PREP_READY" ? "Join" : "Rejoin"}</Link></Button> : null}
                        {s.status === "COMPLETED" || s.status === "ABORTED_TECHNICAL" ? <Button asChild size="sm" variant="outline"><Link href={`${ROUTES.interviews}/${s.id}/report`}>Debrief</Link></Button> : null}
                        {canInterview && MOVABLE.has(s.status) && byId.has(s.id) ? <Button size="sm" variant="ghost" onClick={() => setMoving(s.id)}>Reschedule</Button> : null}
                        {MOVABLE.has(s.status) ? <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={cancelling} onClick={() => cancel(s.id)}>Cancel</Button> : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>

      <BookRoundDialog loop={l} nodeId={booking} onOpenChange={(o) => { if (!o) setBooking(null); }} />
      <RescheduleDialog session={movingSession} onOpenChange={(o) => { if (!o) setMoving(null); }} />
      {cancelConfirmation}
      <ConfirmationDialog open={abandoning} onOpenChange={setAbandoning} title="Abandon this track?" description="Its upcoming interviews will be cancelled." confirmLabel="Abandon track" destructive pending={setStatus.isPending} onConfirm={() => change("abandoned")} />
    </div>
  );
}
