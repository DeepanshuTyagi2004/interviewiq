"use client";

import * as React from "react";
import { HudCard, HudEmpty, StatusDot, type DotState } from "@/components/hud";
import { Button } from "@/components/ui/button";
import { useEvaluationRuns, type EvaluationRunStatus, type EvaluationRunSummary } from "@/features/evaluations-admin";
import { timeAgo } from "@/features/research";
import { ApiFetchError } from "@/lib/api-client/client";
import { cn } from "@/lib/utils/cn";
import { formatMs } from "../prep/format";
import { FIELD } from "../prep/ui";

const PAGE_SIZE = 25;

export const EVALUATION_RUN_DOT: Record<EvaluationRunStatus, DotState> = {
  running: "live",
  completed: "active",
  failed: "error",
  cancelled: "idle",
};

const STATUSES: EvaluationRunStatus[] = ["running", "completed", "failed", "cancelled"];
const OUTCOMES = ["passed", "below_pass", "auto_fail", "unscorable"];

/** "Meesho · SDE I · DSA" from the run's snapshot of the round. */
export function evaluationRunTitle(run: Pick<EvaluationRunSummary, "company" | "role" | "level" | "round_type">): string {
  return [run.company, run.role, run.level, run.round_type].filter(Boolean).join(" · ") || "Round";
}

/** Left pane: filters and the newest-first evaluation runs (running rows poll), with "Load more". */
export function EvaluationRunList({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string) => void }) {
  const [status, setStatus] = React.useState("");
  const [outcome, setOutcome] = React.useState("");
  const query = React.useMemo(() => ({ status: status || undefined, outcome: outcome || undefined, limit: PAGE_SIZE }), [status, outcome]);
  const queryKey = JSON.stringify(query);
  const [pages, setPages] = React.useState<{ key: string; cursors: string[] }>({ key: queryKey, cursors: [] });
  const cursors = pages.key === queryKey ? pages.cursors : [];
  const more = (cursor: string) => setPages({ key: queryKey, cursors: [...cursors, cursor] });

  return (
    <HudCard title="Evaluation runs" spotlight={false} bodyClassName="flex flex-col">
      <div className="flex flex-wrap gap-2 border-b border-line px-4 py-3 sm:px-5">
        <select aria-label="Status" className={FIELD} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="Outcome" className={FIELD} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          <option value="">Any outcome</option>
          {OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      <Page query={query} cursor={undefined} isLast={cursors.length === 0} filtered={!!(status || outcome)} selectedId={selectedId} onSelect={onSelect} onMore={more} />
      {cursors.map((c, i) => (
        <Page key={c} query={query} cursor={c} isLast={i === cursors.length - 1} filtered selectedId={selectedId} onSelect={onSelect} onMore={more} />
      ))}
    </HudCard>
  );
}

function Page({
  query, cursor, isLast, filtered, selectedId, onSelect, onMore,
}: {
  query: { status?: string; outcome?: string; limit: number };
  cursor: string | undefined;
  isLast: boolean;
  filtered: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMore: (cursor: string) => void;
}) {
  const q = useEvaluationRuns(cursor ? { ...query, cursor } : query);
  const first = cursor === undefined;
  if (q.isPending) return <p className="m-0 px-4 py-3 text-[13px] text-muted-foreground sm:px-5">Loading runs…</p>;
  if (q.isError && !q.data) {
    return (
      <p role="alert" className="m-0 px-4 py-3 text-[13px] text-destructive sm:px-5">
        Could not load runs: {q.error instanceof ApiFetchError ? q.error.message : "unknown error"}
      </p>
    );
  }
  const runs = q.data?.runs ?? [];
  if (first && runs.length === 0) {
    return filtered ? (
      <HudEmpty title="No runs match these filters" hint="Clear a filter." />
    ) : (
      <HudEmpty title="No evaluation runs yet" hint="A run starts when a candidate's round completes." />
    );
  }
  const next = q.data?.next_cursor ?? null;
  return (
    <>
      <ul aria-label={first ? "Evaluation runs" : "More evaluation runs"} className="m-0 list-none divide-y divide-line border-b border-line p-0 last:border-b-0">
        {runs.map((run) => (
          <li key={run.run_id}>
            <button
              type="button"
              aria-current={run.run_id === selectedId ? "true" : undefined}
              onClick={() => onSelect(run.run_id)}
              className={cn(
                "flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none sm:px-5",
                run.run_id === selectedId && "bg-accent shadow-[inset_2px_0_0_hsl(var(--brand))]",
              )}
            >
              <span className="flex w-full min-w-0 items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-[13.5px]">{evaluationRunTitle(run)}</span>
                <StatusDot
                  state={EVALUATION_RUN_DOT[run.status]}
                  label={run.status}
                  className={cn(run.status === "failed" ? "text-destructive" : run.status === "running" ? "text-foreground" : "text-muted-foreground")}
                />
              </span>
              <span className="flex w-full min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-faint">
                <span className="font-mono">{run.trigger}</span>
                {run.outcome ? <span className="font-mono">{run.outcome}</span> : null}
                <span className="font-mono tabular-nums">{formatMs(run.duration_ms)}</span>
                {run.session_id ? <span className="min-w-0 max-w-[10ch] truncate font-mono" title={run.session_id}>{run.session_id.slice(0, 8)}</span> : null}
                <time dateTime={run.created_at} title={run.created_at} className="ml-auto font-mono">{timeAgo(run.created_at)}</time>
              </span>
              {run.status === "failed" && run.error ? <span className="block w-full truncate font-mono text-[11.5px] text-destructive">{run.error.code}</span> : null}
            </button>
          </li>
        ))}
      </ul>
      {isLast && next ? (
        <div className="px-4 py-3 sm:px-5">
          <Button type="button" size="sm" variant="strong" className="w-full" onClick={() => onMore(next)}>Load more</Button>
        </div>
      ) : null}
    </>
  );
}
