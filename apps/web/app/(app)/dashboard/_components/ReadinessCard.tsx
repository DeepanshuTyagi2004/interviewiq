"use client";

import Link from "next/link";
import { HudCard, SegmentMeter } from "@/components/hud";
import { Skeleton } from "@/components/ui/skeleton";
import { readinessSummary, useLoops, type Loop } from "@/features/loops";
import { ROUTES } from "@/lib/constants/shared";

const u = (n: number) => `calc(${n}*var(--u))`;

/** Loops still in play, best-progressed first. */
function liveLoops(loops: Loop[]): Loop[] {
  return loops
    .filter((l) => l.status === "active" || l.status === "paused")
    .sort((a, b) => b.progress.completed / Math.max(b.progress.total, 1) - a.progress.completed / Math.max(a.progress.total, 1));
}

function nextLabel(l: Loop): string {
  if (l.status === "paused") return "Paused";
  const next = l.graph.nodes.find((n) => n.kind === "round" && l.progress.nextNodeIds.includes(n.id));
  if (next) return `Next: ${next.name}`;
  const booked = Object.values(l.nodeStates).includes("booked");
  return booked ? "Round booked" : "Waiting";
}

/**
 * Your loops and readiness. Readiness counts only rounds completed in unedited, suggested
 * processes; edited (standalone) loops are listed but never counted. Sizes follow `--u`.
 */
export function ReadinessCard({ className }: { className?: string }) {
  const { data, isLoading } = useLoops();
  const loops = data ?? [];
  const live = liveLoops(loops);
  const summary = readinessSummary(loops);

  return (
    <HudCard
      notch
      glow="bl"
      title="Tracks & readiness"
      aria-label="Tracks and readiness"
      className={className}
      bodyClassName="flex flex-col gap-[calc(14*var(--u))] px-[calc(18*var(--u))] py-[calc(22*var(--u))] sm:px-[calc(26*var(--u))]"
    >
      {isLoading ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : live.length === 0 && !summary ? (
        <>
          <p className="m-0 text-[length:calc(34*var(--u))] leading-[1.1] tracking-[-0.035em]">Not started</p>
          <SegmentMeter segments={4} filled={0} size="md" className="mt-[calc(4*var(--u))]" />
          <p className="m-0 text-[length:calc(16*var(--u))] leading-[1.55] text-muted-foreground">
            Confirm a role&apos;s process to start a track. Readiness rises as you complete rounds of an unedited process. Edited
            tracks don&apos;t count.
          </p>
          <Link href={ROUTES.jobs} className="mt-auto self-start text-[length:calc(16*var(--u))] text-foreground underline underline-offset-[calc(4*var(--u))]">
            Choose a target role
          </Link>
        </>
      ) : (
        <>
          {summary ? (
            <div>
              <p className="m-0 text-[length:calc(30*var(--u))] leading-[1.1] tracking-[-0.035em] tabular-nums">
                {summary.completed} of {summary.total} <span className="text-[length:calc(16*var(--u))] text-muted-foreground">rounds completed</span>
              </p>
              <SegmentMeter segments={Math.max(summary.total, 1)} filled={summary.completed} tone="brand" size="md" className="mt-[calc(10*var(--u))]" label={`${summary.completed} of ${summary.total} rounds completed`} />
              <p className="m-0 mt-[calc(8*var(--u))] text-[length:calc(13*var(--u))] text-muted-foreground">Counts unedited processes only.</p>
            </div>
          ) : (
            <p className="m-0 text-[length:calc(15*var(--u))] leading-[1.5] text-muted-foreground">
              Your tracks use edited processes, so they&apos;re standalone practice and don&apos;t count towards readiness.
            </p>
          )}
          <ul className="m-0 flex list-none flex-col gap-[calc(10*var(--u))] p-0">
            {live.slice(0, 3).map((l) => (
              <li key={l.id}>
                <Link href={`${ROUTES.loops}/${l.id}`} className="block rounded-lg border border-line-2 px-[calc(12*var(--u))] py-[calc(10*var(--u))] transition-colors hover:border-faint-2">
                  <span className="flex items-baseline justify-between gap-2 text-[length:calc(14.5*var(--u))]">
                    <span className="truncate">{l.jd ? `${l.jd.companyName} · ${l.jd.title}` : "Track"}</span>
                    <span className="flex-none font-mono text-[length:calc(11.5*var(--u))] tabular-nums text-muted-foreground">{l.progress.completed}/{l.progress.total}</span>
                  </span>
                  <SegmentMeter segments={Math.max(l.progress.total, 1)} filled={l.progress.completed} tone="brand" className="mt-[calc(6*var(--u))]" />
                  <span className="mt-[calc(6*var(--u))] flex justify-between gap-2 text-[length:calc(12.5*var(--u))] text-faint">
                    <span className="truncate">{nextLabel(l)}</span>
                    {!l.countsTowardReadiness ? <span className="flex-none">Standalone</span> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Link href={ROUTES.loops} className="mt-auto self-start text-[length:calc(15*var(--u))] text-foreground underline underline-offset-[calc(4*var(--u))]">
            {live.length > 3 ? `Manage all ${live.length} tracks` : "Manage tracks"}
          </Link>
        </>
      )}
    </HudCard>
  );
}
