"use client";

import Link from "next/link";
import { Card, CompanyMark, EmptyState, SectionHeader, SegmentBar } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { readinessLabel, readinessSummary, useLoops, type Loop } from "@/features/loops";
import { levelLabel } from "@/lib/constants/engineering-levels";
import { ROUTES } from "@/lib/constants/shared";
import { cn } from "@/lib/utils/cn";

const MAX_ROWS = 4;

/** Loops still in play, best-progressed first. */
function liveLoops(loops: Loop[]): Loop[] {
  return loops
    .filter((l) => l.status === "active" || l.status === "paused")
    .sort((a, b) => b.progress.completed / Math.max(b.progress.total, 1) - a.progress.completed / Math.max(a.progress.total, 1));
}

function trackName(l: Loop): string {
  return `${l.name}${l.level ? ` · ${levelLabel(l.level)}` : ""}`;
}

function progressText(l: Loop): string {
  if (l.status === "paused") return "Paused";
  const { completed, total } = l.progress;
  if (completed === 0) return Object.values(l.nodeStates).includes("booked") ? "Round booked" : "Not started";
  return `${completed} of ${total} rounds passed`;
}

/** Mock-readiness wording beside a row. Edited tracks are standalone and carry no level. */
/** "Next: Online coding" while a round is up next; null otherwise. */
function nextText(l: Loop): string | null {
  if (l.status === "paused") return null;
  const next = l.graph.nodes.find((n) => n.kind === "round" && l.progress.nextNodeIds.includes(n.id));
  return next ? `Next: ${next.name}` : null;
}

function levelText(l: Loop): string {
  if (!l.countsTowardReadiness) return "Standalone";
  return l.readiness ? readinessLabel(l.readiness) : "Getting started";
}

/**
 * Your tracks and mock-interview readiness. Readiness counts only rounds passed in unedited,
 * suggested processes; edited (standalone) tracks are listed but never counted.
 */
export function ReadinessCard({ className }: { className?: string }) {
  const { data, isLoading } = useLoops();
  const loops = data ?? [];
  const live = liveLoops(loops);
  const summary = readinessSummary(loops);

  return (
    <div className={cn("flex flex-col", className)}>
      <SectionHeader title="Readiness" href={ROUTES.loops} />
      <Card aria-label="Tracks and readiness" className="min-h-[260px] flex-1">
        {isLoading ? (
          <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading tracks">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : live.length === 0 ? (
          <EmptyState
            className="my-auto py-6"
            title="Not started"
            hint="Confirm a role's process to start a track. Readiness rises as you pass rounds of an unedited process. Counts unedited processes only."
          >
            <Button asChild variant="secondary">
              <Link href={ROUTES.jobs}>Choose a target role</Link>
            </Button>
          </EmptyState>
        ) : (
          <>
            <ul className="m-0 flex list-none flex-col p-0">
              {live.slice(0, MAX_ROWS).map((l, i) => {
                const company = l.jd?.companyName ?? l.name;
                return (
                  <li key={l.id} className={i === 0 ? "pb-3.5" : "border-t border-line py-3.5"}>
                    <Link
                      href={`${ROUTES.loops}/${l.id}`}
                      className="flex items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      <CompanyMark seed={l.jd?.company ?? company} name={company} size={40} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium" title={trackName(l)}>
                          {trackName(l)}
                        </span>
                        <small className="mt-0.5 block truncate text-[12.5px] text-ink-3">{progressText(l)}
                          {nextText(l) ? <span title={nextText(l)!}> · {nextText(l)}</span> : null}
                        </small>
                        <SegmentBar
                          segments={Math.max(l.progress.total, 1)}
                          filled={l.progress.completed}
                          className="mt-2"
                        />
                      </span>
                      <span className="max-w-[40%] flex-none truncate text-[12.5px] text-ink-2">{levelText(l)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line pt-3.5 text-[12.5px] text-ink-3">
              <span>
                {summary ? `${summary.completed} of ${summary.total} rounds passed · ` : ""}Counts unedited processes only.
              </span>
              {live.length > MAX_ROWS ? (
                <Link href={ROUTES.loops} className="text-ink underline underline-offset-4">
                  Manage all {live.length} tracks
                </Link>
              ) : null}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
