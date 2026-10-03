"use client";

import Link from "next/link";
import { toast } from "sonner";
import { HudCard, SegmentMeter } from "@/components/hud";
import { Button } from "@/components/ui/button";
import { roundTypeLabel, useSetLoopStatus, type Loop } from "@/features/loops";
import { JdTitle, KindPill, LoopStatusPill, loopHref } from "./loopUi";

export function loopNextRounds(loop: Loop) {
  return loop.graph.nodes.filter((n) => n.kind === "round" && loop.progress.nextNodeIds.includes(n.id));
}

/** One loop: role, how far along it is, what unlocks next, and quick actions. */
export function LoopCard({ loop, onBook }: { loop: Loop; onBook?: (loop: Loop, nodeId: string) => void }) {
  const setStatus = useSetLoopStatus();
  const { total, completed } = loop.progress;
  const next = loop.status === "active" ? loopNextRounds(loop) : [];

  function change(status: "active" | "paused" | "abandoned") {
    if (status === "abandoned" && !window.confirm("Abandon this track? Its upcoming interviews will be cancelled.")) return;
    setStatus.mutate({ id: loop.id, status }, { onError: () => toast.error("Couldn't update the track. Please try again.") });
  }

  return (
    <HudCard as="article" glow="tr" title={<LoopStatusPill status={loop.status} />} meta={<KindPill loop={loop} />} bodyClassName="flex flex-col gap-4 p-4 sm:p-5">
      <JdTitle jd={loop.jd} href={loopHref(loop.id)} />
      <div>
        <p className="m-0 mb-2 flex justify-between text-[13px]">
          <span className="text-faint">Progress</span>
          <span>{completed} of {total} rounds completed</span>
        </p>
        <SegmentMeter segments={Math.max(total, 1)} filled={completed} tone="brand" size="md" label={`${completed} of ${total} rounds completed`} />
      </div>
      {next.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-faint">Next:</span>
          {next.map((n) =>
            n.kind === "round" ? (
              <Button key={n.id} size="sm" onClick={() => onBook?.(loop, n.id)} disabled={!onBook}>
                Book {n.name}
                <span className="font-mono text-[11px] opacity-70">{roundTypeLabel(n.type)}</span>
              </Button>
            ) : null,
          )}
        </div>
      ) : loop.status === "completed" ? (
        <p className="m-0 text-[13px] text-muted-foreground">Every round of this track is completed.</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="strong" size="sm"><Link href={loopHref(loop.id)}>Open track</Link></Button>
        {loop.status === "active" ? <Button variant="ghost" size="sm" disabled={setStatus.isPending} onClick={() => change("paused")}>Pause</Button> : null}
        {loop.status === "paused" ? <Button variant="ghost" size="sm" disabled={setStatus.isPending} onClick={() => change("active")}>Resume</Button> : null}
        {loop.status === "active" || loop.status === "paused" ? (
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={setStatus.isPending} onClick={() => change("abandoned")}>Abandon</Button>
        ) : null}
      </div>
    </HudCard>
  );
}
