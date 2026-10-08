"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import { HudCard, HudEmpty } from "@/components/hud";
import { Button } from "@/components/ui/button";
import { useBlueprintRuns, type BlueprintRunFilters } from "@/features/blueprints";
import { ApiFetchError } from "@/lib/api-client/client";
import { EMPTY_FILTERS, RunFilters, type RunFilterState } from "./RunFilters";
import { RunRow } from "./RunRow";
import { useDebounced } from "./useDebounced";

const PAGE_SIZE = 25;

/** Typed filters settle before they refetch; selects apply at once. */
function toQuery(f: RunFilterState, company: string, candidateId: string): BlueprintRunFilters {
  return {
    status: (f.status || undefined) as BlueprintRunFilters["status"],
    round_type: (f.roundType || undefined) as BlueprintRunFilters["round_type"],
    trigger: (f.trigger || undefined) as BlueprintRunFilters["trigger"],
    company: company.trim() || undefined,
    candidate_id: candidateId.trim() || undefined,
    limit: PAGE_SIZE,
  };
}

/** Left pane: filters, the newest-first run list (running rows poll) and "Load more" pages. */
export function RunList({
  selectedId,
  onSelect,
  onNewRun,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewRun: () => void;
}) {
  const [filters, setFilters] = React.useState<RunFilterState>(EMPTY_FILTERS);
  const company = useDebounced(filters.company);
  const candidateId = useDebounced(filters.candidateId);
  const query = React.useMemo(() => toQuery(filters, company, candidateId), [filters, company, candidateId]);
  const queryKey = JSON.stringify(query);
  // Extra pages, by cursor. They belong to one filter set; a filter change starts again at page one.
  const [pages, setPages] = React.useState<{ key: string; cursors: string[] }>({ key: queryKey, cursors: [] });
  const cursors = pages.key === queryKey ? pages.cursors : [];
  const more = (cursor: string) => setPages({ key: queryKey, cursors: [...cursors, cursor] });

  return (
    <HudCard
      title="Blueprint runs"
      spotlight={false}
      action={
        <Button type="button" size="sm" onClick={onNewRun}>
          <Plus aria-hidden />
          New run
        </Button>
      }
      bodyClassName="flex flex-col"
    >
      <div className="border-b border-line px-4 py-3 sm:px-5">
        <RunFilters value={filters} onChange={setFilters} />
      </div>
      <RunPage query={query} cursor={undefined} isLast={cursors.length === 0} filtered={Object.values(filters).some(Boolean)} selectedId={selectedId} onSelect={onSelect} onMore={more} />
      {cursors.map((c, i) => (
        <RunPage key={c} query={query} cursor={c} isLast={i === cursors.length - 1} filtered selectedId={selectedId} onSelect={onSelect} onMore={more} />
      ))}
    </HudCard>
  );
}

function RunPage({
  query,
  cursor,
  isLast,
  filtered,
  selectedId,
  onSelect,
  onMore,
}: {
  query: BlueprintRunFilters;
  cursor: string | undefined;
  isLast: boolean;
  filtered: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMore: (cursor: string) => void;
}) {
  const q = useBlueprintRuns(cursor ? { ...query, cursor } : query);
  const first = cursor === undefined;

  if (q.isPending) {
    return <p className="m-0 px-4 py-3 text-[13px] text-muted-foreground sm:px-5">Loading runs…</p>;
  }
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
      <HudEmpty title="No runs match these filters" hint="Clear a filter, or start a bench run." />
    ) : (
      <HudEmpty title="No blueprint runs yet" hint="A run starts when a candidate books a round. Start a bench run to prepare one by hand." />
    );
  }
  const next = q.data?.next_cursor ?? null;
  return (
    <>
      <ul aria-label={first ? "Runs" : "More runs"} className="m-0 list-none divide-y divide-line border-b border-line p-0 last:border-b-0">
        {runs.map((run) => (
          <li key={run.run_id}>
            <RunRow run={run} selected={run.run_id === selectedId} onSelect={onSelect} />
          </li>
        ))}
      </ul>
      {isLast && next ? (
        <div className="px-4 py-3 sm:px-5">
          <Button type="button" size="sm" variant="strong" className="w-full" onClick={() => onMore(next)}>
            Load more
          </Button>
        </div>
      ) : null}
    </>
  );
}
