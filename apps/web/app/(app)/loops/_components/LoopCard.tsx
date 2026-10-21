"use client";

import Link from "next/link";
import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Card, Orb, SegmentBar } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { roundTypeLabel, useSetLoopStatus, type Loop } from "@/features/loops";
import { KindPill, LoopStatusPill, loopHref } from "./loopUi";
import { levelLabel } from "@/lib/constants/engineering-levels";

export function loopNextRounds(loop: Loop) {
  return loop.graph.nodes.filter((n) => n.kind === "round" && loop.progress.nextNodeIds.includes(n.id));
}

/** One loop as a wide row: role, how far along it is, what unlocks next, and quick actions. */
export function LoopCard({ loop, onBook }: { loop: Loop; onBook?: (loop: Loop, nodeId: string) => void }) {
  const setStatus = useSetLoopStatus();
  const [abandoning, setAbandoning] = useState(false);
  const { total, completed } = loop.progress;
  const next = loop.status === "active" ? loopNextRounds(loop) : [];
  const live = loop.status === "active" || loop.status === "paused";
  const title = loop.jd?.title ?? loop.name;
  const sub = loop.jd ? `${loop.jd.companyName} · ${levelLabel(loop.level ?? loop.jd.level)}` : [loop.level ? levelLabel(loop.level) : null, "Standalone practice"].filter(Boolean).join(" · ");

  function change(status: "active" | "paused" | "abandoned") {
    setStatus.mutate({ id: loop.id, status }, { onError: () => toast.error("Couldn't update the track. Please try again.") });
  }

  return (
    <Card as="article" aria-label={`${title}, ${sub}`} interactive className="p-5">
      <div className="grid items-center gap-x-6 gap-y-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_260px]">
        <div className="flex min-w-0 items-center gap-3.5">
          <Orb seed={loop.jd?.company ?? loop.id} size={44} />
          <div className="min-w-0">
            <Link
              href={loopHref(loop.id)}
              title={title}
              className="block truncate rounded-sm font-display text-[18px] font-normal leading-tight tracking-[-0.02em] outline-none hover:underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {title}
            </Link>
            <span className="mt-0.5 block truncate text-[13px] text-ink-3" title={sub}>{sub}</span>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <LoopStatusPill status={loop.status} />
              <KindPill loop={loop} />
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <p className="m-0 mb-2 flex justify-between gap-3 text-[13px]">
            <span className="text-ink-3">Progress</span>
            <span className="tabular-nums">{completed} of {total} rounds completed</span>
          </p>
          <SegmentBar segments={Math.max(total, 1)} filled={completed} size="md" label={`${completed} of ${total} rounds completed`} />
          {next.length > 0 ? (
            <p className="m-0 mt-2 truncate text-[12.5px] text-ink-3" title={next.map((n) => n.name).join(", ")}>Next: {next.map((n) => n.name).join(", ")}</p>
          ) : loop.status === "completed" ? (
            <p className="m-0 mt-2 text-[12.5px] text-ink-3">Every round of this track is completed.</p>
          ) : loop.status === "paused" ? (
            <p className="m-0 mt-2 text-[12.5px] text-ink-3">Paused. Resume to book.</p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          {next.map((n) =>
            n.kind === "round" ? (
              <Button key={n.id} size="sm" className="max-w-[calc(100%-44px)]" title={`Book ${n.name}`} onClick={() => onBook?.(loop, n.id)} disabled={!onBook}>
                <span className="truncate">Book {n.name}</span>
                {roundTypeLabel(n.type).toLowerCase() !== n.name.toLowerCase() ? <span className="hidden flex-none text-[12px] opacity-70 xl:inline">{roundTypeLabel(n.type)}</span> : null}
              </Button>
            ) : null,
          )}
          {next.length === 0 ? <Button asChild variant="outline" size="sm"><Link href={loopHref(loop.id)}>Open track</Link></Button> : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Track actions" disabled={setStatus.isPending}>
                <MoreHorizontal aria-hidden strokeWidth={1.8} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild><Link href={loopHref(loop.id)}>Open track</Link></DropdownMenuItem>
              {loop.status === "active" ? <DropdownMenuItem onSelect={() => change("paused")}>Pause</DropdownMenuItem> : null}
              {loop.status === "paused" ? <DropdownMenuItem onSelect={() => change("active")}>Resume</DropdownMenuItem> : null}
              {live ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setAbandoning(true)}>Abandon</DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <ConfirmationDialog open={abandoning} onOpenChange={setAbandoning} title="Abandon this track?" description="Its upcoming interviews will be cancelled." confirmLabel="Abandon track" destructive pending={setStatus.isPending} onConfirm={() => change("abandoned")} />
    </Card>
  );
}
