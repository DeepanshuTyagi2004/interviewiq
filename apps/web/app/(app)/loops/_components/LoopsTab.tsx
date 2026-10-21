"use client";

import { useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLoops, type Loop } from "@/features/loops";
import { BookRoundDialog } from "@/features/loops/components/SlotDialog";
import { ROUTES } from "@/lib/constants/shared";
import { LoopCard } from "./LoopCard";

const LIVE = new Set(["active", "paused"]);

export function LoopsTab() {
  const loops = useLoops();
  const [booking, setBooking] = useState<{ loopId: string; nodeId: string } | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  if (loops.isLoading) return <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading tracks">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[112px] rounded-card" />)}</div>;
  if (loops.isError) return <EmptyState title="Couldn't load your tracks" action={<Button variant="outline" size="sm" onClick={() => void loops.refetch()}>Try again</Button>} />;

  const all = loops.data ?? [];
  const live = all.filter((l) => LIVE.has(l.status));
  const closed = all.filter((l) => !LIVE.has(l.status));
  const active: Loop | undefined = booking ? all.find((l) => l.id === booking.loopId) : undefined;

  if (all.length === 0) {
    return (
      <EmptyState
        title="No tracks yet"
        hint="Pick a company and a role, then confirm its interview process. It becomes a track here, and you book each round into a free slot."
        action={<Button asChild><Link href={ROUTES.jobs}>Choose a company</Link></Button>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-[13px] leading-[1.5] text-ink-3">
        You can run several tracks at once. Rounds are booked into different slots: two interviews can never share the same slot.
      </p>
      <div className="flex flex-col gap-3">
        {live.map((l) => <LoopCard key={l.id} loop={l} onBook={(loop, nodeId) => setBooking({ loopId: loop.id, nodeId })} />)}
      </div>
      {live.length === 0 ? <p className="m-0 text-sm text-ink-3">No active tracks. Start one from a company page.</p> : null}
      {closed.length > 0 ? (
        <>
          <Button variant="outline" size="sm" className="self-start" onClick={() => setShowClosed((v) => !v)}>
            {showClosed ? "Hide" : "Show"} finished and abandoned tracks ({closed.length})
          </Button>
          {showClosed ? (
            <div className="flex flex-col gap-3">
              {closed.map((l) => <LoopCard key={l.id} loop={l} />)}
            </div>
          ) : null}
        </>
      ) : null}
      {active ? <BookRoundDialog loop={active} nodeId={booking?.nodeId ?? null} onOpenChange={(o) => { if (!o) setBooking(null); }} /> : null}
    </div>
  );
}
