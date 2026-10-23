"use client";

import { Button } from "@/components/ui/button";
import { ApiFetchError } from "@/lib/api-client/errors";
import { useProfileScore, useRecalculateProfileScore } from "../hooks";

const whenLabel = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/**
 * Recalculate button plus what it does: it re-runs the AI assessment for new or changed items in the background,
 * so the score card shows a "being assessed" state (polling) and then the new score. Three runs per rolling week.
 */
export function RecalculateControl({ label = "Recalculate profile score", disabled = false, refresh = true }: { label?: string; disabled?: boolean; refresh?: boolean }) {
  const query = useProfileScore();
  const recalculate = useRecalculateProfileScore();
  const assessment = query.data?.assessment;
  const assessing = recalculate.isPending || Boolean(assessment?.inProgress);
  const outOfRuns = Boolean(assessment?.available && assessment.remaining === 0);
  const limitHit = recalculate.error instanceof ApiFetchError && recalculate.error.code === "profile_scoring_recalculation_limit";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={disabled || assessing || outOfRuns} onClick={() => recalculate.mutate()}>
          {assessing ? "Recalculating…" : label}
        </Button>
        {refresh ? <Button size="sm" variant="ghost" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh</Button> : null}
      </div>
      {assessing ? (
        <p role="status" className="m-0 text-xs text-ink-2">Assessing your projects and experience. This takes a minute; your score updates here when it&apos;s done.</p>
      ) : assessment?.available ? (
        <p className="m-0 text-xs text-ink-2">
          {outOfRuns
            ? `No recalculations left this week${assessment.nextAvailableAt ? `. The next one is available ${whenLabel(assessment.nextAvailableAt)}` : ""}.`
            : `${assessment.remaining} of ${assessment.limit} recalculations left this week. Only new or changed items are re-assessed.`}
        </p>
      ) : null}
      {recalculate.isError ? (
        <p role="alert" className="m-0 text-sm text-destructive">
          {limitHit ? (recalculate.error as ApiFetchError).message : "Could not recalculate profile score. Please retry."}
        </p>
      ) : null}
    </div>
  );
}
