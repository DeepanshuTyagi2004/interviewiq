"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { PAGE_SCAFFOLD } from "@/components/layout/page";
import { Count, HudCard, SegmentMeter } from "@/components/hud";
import { EmptyState } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusPill } from "@/app/(app)/interviews/_components/StatusPill";
import { useMySessions } from "@/features/interview";
import { formatSlot } from "@/features/interview/presentation";
import { useLoop, useSetLoopStatus } from "@/features/loops";
import { FlowCanvas } from "@/features/loops/components/FlowCanvas";
import { BookRoundDialog, RescheduleDialog, useCancelWithToast } from "@/features/loops/components/SlotDialog";
import { ApiFetchError } from "@/lib/api-client/errors";
import { ROUTES } from "@/lib/constants/shared";
import { JdTitle, KindPill, LoopStatusPill } from "./loopUi";

const MOVABLE = new Set(["SCHEDULED", "PREP_READY", "PREP_FAILED"]);

/** `/loops/[loopId]`: one track's flow with per-round state, booking, and its interviews. */
export function LoopDetail({ loopId }: { loopId: string }) {
  const loop = useLoop(loopId);
  const mySessions = useMySessions();
  const setStatus = useSetLoopStatus();
  const { cancel, pending: cancelling } = useCancelWithToast();
  const [booking, setBooking] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);

  if (loop.isLoading) return <div className={PAGE_SCAFFOLD}><Skeleton className="h-[480px] rounded-[14px]" /></div>;
  if (loop.isError || !loop.data) {
    const missing = loop.error instanceof ApiFetchError && loop.error.status === 404;
    return (
      <div className={PAGE_SCAFFOLD}>
        <EmptyState
          title={missing ? "This track doesn't exist" : "Couldn't load this track"}
          action={<Button asChild variant="strong" size="sm"><Link href={ROUTES.loops}>Back to My tracks</Link></Button>}
        />
      </div>
    );
  }

  const l = loop.data;
  const { total, completed } = l.progress;
  const live = l.status === "active" || l.status === "paused";
  const byId = new Map((mySessions.data?.sessions ?? []).map((s) => [s.id, s]));
  const nodeName = (id: string | null) => l.graph.nodes.find((n) => n.id === id)?.name ?? "Round";
  const rows = [...l.sessions].sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  const movingSession = moving ? byId.get(moving) ?? null : null;

  function change(status: "active" | "paused" | "abandoned") {
    if (status === "abandoned" && !window.confirm("Abandon this track? Its upcoming interviews will be cancelled.")) return;
    setStatus.mutate({ id: l.id, status }, { onError: (err) => toast.error(err instanceof ApiFetchError && err.code === "loop_exists" ? "You already have another active track for this role." : "Couldn't update the track.") });
  }

  return (
    <div className={PAGE_SCAFFOLD}>
      <nav aria-label="Breadcrumb">
        <ol className="m-0 flex list-none flex-wrap items-center gap-x-2 p-0 text-[13px] text-faint">
          <li className="flex items-center gap-2"><Link href={ROUTES.loops} className="rounded-sm hover:text-foreground">My tracks</Link><span aria-hidden>›</span></li>
          <li aria-current="page" className="text-foreground">{l.jd ? `${l.jd.companyName} · ${l.jd.title}` : "Track"}</li>
        </ol>
      </nav>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex flex-col gap-2.5">
          <JdTitle jd={l.jd} href={l.jd ? `${ROUTES.jobs}/${l.jd.jdId}` : undefined} />
          <div className="flex flex-wrap items-center gap-2"><LoopStatusPill status={l.status} /><KindPill loop={l} /></div>
        </div>
        {live ? (
          <div className="flex flex-wrap gap-2">
            {l.status === "active" ? <Button variant="strong" size="sm" disabled={setStatus.isPending} onClick={() => change("paused")}>Pause</Button> : <Button size="sm" disabled={setStatus.isPending} onClick={() => change("active")}>Resume</Button>}
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={setStatus.isPending} onClick={() => change("abandoned")}>Abandon</Button>
          </div>
        ) : null}
      </div>

      <div className="mt-5 max-w-[420px]">
        <p className="m-0 mb-2 flex justify-between text-[13px]"><span className="text-faint">Progress</span><span>{completed} of {total} rounds completed</span></p>
        <SegmentMeter segments={Math.max(total, 1)} filled={completed} tone="brand" size="md" label={`${completed} of ${total} rounds completed`} />
      </div>

      <HudCard title="Flow" meta={l.status === "paused" ? "Paused: resume to book" : "Click “Book this round” on a ready round"} className="mt-5" bodyClassName="p-3 sm:p-4">
        <FlowCanvas
          graph={l.graph}
          mode="view"
          nodeStates={l.nodeStates}
          onBookNode={l.status === "active" ? setBooking : undefined}
          className="h-[420px]"
        />
        <p className="m-0 mt-3 px-1 text-[12.5px] leading-[1.5] text-muted-foreground">
          A round unlocks once every round leading into it is completed.{" "}
          {l.countsTowardReadiness
            ? "This is the unedited process, so completed rounds count towards your readiness for this role."
            : "This is your edited process: it gets full analysis but isn't counted towards readiness."}
        </p>
      </HudCard>

      <HudCard title="Interviews in this track" meta={<Count n={rows.length} label={`${rows.length} interviews`} />} className="mt-4">
        {rows.length === 0 ? (
          <p className="m-0 px-5 py-6 text-sm text-muted-foreground">Nothing booked yet. Book the first ready round above.</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {rows.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3.5 last:border-b-0 sm:px-5">
                <div className="min-w-0">
                  <p className="m-0 truncate text-sm">{nodeName(s.nodeId)}</p>
                  <p className="m-0 mt-0.5 font-mono text-[11.5px] text-faint">{formatSlot(s.scheduledAt)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill status={s.status} />
                  {s.status === "PREP_READY" || s.status === "LIVE_IN_PROGRESS" ? <Button asChild size="sm"><Link href={`${ROUTES.interviews}/${s.id}/live`}>{s.status === "PREP_READY" ? "Join" : "Rejoin"}</Link></Button> : null}
                  {s.status === "COMPLETED" || s.status === "ABORTED_TECHNICAL" ? <Button asChild size="sm" variant="strong"><Link href={`${ROUTES.interviews}/${s.id}/report`}>Debrief</Link></Button> : null}
                  {MOVABLE.has(s.status) && byId.has(s.id) ? <Button size="sm" variant="ghost" onClick={() => setMoving(s.id)}>Reschedule</Button> : null}
                  {MOVABLE.has(s.status) ? <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={cancelling} onClick={() => cancel(s.id)}>Cancel</Button> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </HudCard>

      <BookRoundDialog loop={l} nodeId={booking} onOpenChange={(o) => { if (!o) setBooking(null); }} />
      <RescheduleDialog session={movingSession} onOpenChange={(o) => { if (!o) setMoving(null); }} />
    </div>
  );
}
