"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { EvaluationRunDetail } from "./EvaluationRunDetail";
import { EvaluationRunList } from "./EvaluationRunList";

/** The selected run lives in `?evr=` (`run` belongs to the research Runs tab, `bpr` to Interview prep). */
export const EVALUATION_RUN_PARAM = "evr";

/**
 * Intelligence → Evaluations (admin): diagnose how each completed round was graded (post-interview
 * report spec §12.2). Run list on the left, the selected run's graders, tiebreaks and arithmetic on the right.
 */
export function EvaluationsTab() {
  const params = useSearchParams();
  const router = useRouter();
  const selected = params.get(EVALUATION_RUN_PARAM) || null;

  const select = React.useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(params.toString());
      next.set("tab", "evaluations");
      if (id) next.set(EVALUATION_RUN_PARAM, id);
      else next.delete(EVALUATION_RUN_PARAM);
      router.replace(`?${next.toString()}`, { scroll: false });
    },
    [params, router],
  );

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(320px,400px)_minmax(0,1fr)] lg:items-start">
      <EvaluationRunList selectedId={selected} onSelect={select} />
      <EvaluationRunDetail key={selected ?? "none"} runId={selected} onSelectRun={select} />
    </div>
  );
}
