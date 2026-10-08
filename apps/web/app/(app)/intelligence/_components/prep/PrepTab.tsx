"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BenchDialog } from "./BenchDialog";
import { RunDetail } from "./RunDetail";
import { RunList } from "./RunList";

/** The selected run lives in `?bpr=` (`run` belongs to the research Runs tab). */
export const RUN_PARAM = "bpr";

/**
 * Intelligence → Interview prep (admin): diagnose how each interview blueprint was created
 * (spec §10). Run list on the left, the selected run's trace and blueprint on the right.
 */
export function PrepTab() {
  const params = useSearchParams();
  const router = useRouter();
  const selected = params.get(RUN_PARAM) || null;
  const [benchOpen, setBenchOpen] = React.useState(false);

  const select = React.useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(params.toString());
      next.set("tab", "prep");
      if (id) next.set(RUN_PARAM, id);
      else next.delete(RUN_PARAM);
      router.replace(`?${next.toString()}`, { scroll: false });
    },
    [params, router],
  );

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(320px,400px)_minmax(0,1fr)] lg:items-start">
      <RunList selectedId={selected} onSelect={select} onNewRun={() => setBenchOpen(true)} />
      {/* Keyed by run, so an open stage drawer never carries over to another run. */}
      <RunDetail key={selected ?? "none"} runId={selected} onSelectRun={select} />
      <BenchDialog open={benchOpen} onOpenChange={setBenchOpen} onStarted={select} />
    </div>
  );
}
