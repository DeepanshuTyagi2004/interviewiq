"use client";

import { StatusDot } from "@/components/hud";
import { LookPill } from "@/components/observability/ConsoleCard";
import { GHOST_PILL, OUTLINE_PILL } from "@/components/observability/status";
import type { BlueprintRunSummary } from "@/features/blueprints";
import { timeAgo } from "@/features/research";
import { cn } from "@/lib/utils/cn";
import { BLUEPRINT_RUN_DOT } from "../pills";
import { candidateText, formatMs, runTitle } from "./format";

/** One run in the list: what was prepared, for whom, how it went and when. */
export function RunRow({ run, selected, onSelect }: { run: BlueprintRunSummary; selected: boolean; onSelect: (id: string) => void }) {
  const running = run.status === "running";
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      onClick={() => onSelect(run.run_id)}
      className={cn(
        "flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none sm:px-5",
        selected && "bg-accent shadow-[inset_2px_0_0_hsl(var(--brand))]",
      )}
    >
      <span className="flex w-full min-w-0 items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-[13.5px]">{runTitle(run)}</span>
        <StatusDot
          state={BLUEPRINT_RUN_DOT[run.status]}
          label={running && run.stage ? `running · ${run.stage}` : run.status}
          className={cn(running ? "text-foreground" : run.status === "failed" ? "text-destructive" : "text-muted-foreground")}
        />
      </span>
      <span className="flex w-full min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-faint">
        <span className="min-w-0 max-w-full truncate">{candidateText(run)}</span>
        <LookPill look={run.trigger === "bench" ? OUTLINE_PILL : GHOST_PILL}>{run.trigger}</LookPill>
        <span className="font-mono tabular-nums">{formatMs(run.duration_ms)}</span>
        {run.cached ? <LookPill look={OUTLINE_PILL}>cached</LookPill> : null}
        {run.blueprint_version ? <span className="font-mono">v{run.blueprint_version}</span> : null}
        <time dateTime={run.created_at} title={run.created_at} className="ml-auto font-mono">
          {timeAgo(run.created_at)}
        </time>
      </span>
      {run.status === "failed" && run.error ? (
        <span className="block w-full truncate font-mono text-[11.5px] text-destructive">{run.error.code}</span>
      ) : null}
    </button>
  );
}
