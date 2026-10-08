"use client";

import { ChevronRight } from "lucide-react";
import { HudCard } from "@/components/hud";
import { LookPill } from "@/components/observability/ConsoleCard";
import { STEP_DOT, STEP_PILL } from "@/components/observability/status";
import type { BlueprintStage, BlueprintStageId } from "@/features/blueprints";
import { cn } from "@/lib/utils/cn";
import { callTotals, formatCount, formatMs } from "./format";
import { STAGE_LABEL, STAGE_ORDER, stepStatus } from "./vocabulary";

/** All eight stages in pipeline order, filling any the trace hasn't recorded yet as pending. */
export function orderedStages(stages: BlueprintStage[] | undefined): BlueprintStage[] {
  const byId = new Map((stages ?? []).map((s) => [s.id, s]));
  return STAGE_ORDER.map((id) => byId.get(id) ?? { id, label: STAGE_LABEL[id], status: "pending" as const });
}

/** The eight stages with status, duration, models and tokens; a row opens its stage drawer. */
export function StageTimeline({ stages, onOpen }: { stages: BlueprintStage[]; onOpen: (id: BlueprintStageId) => void }) {
  const done = stages.filter((s) => s.status === "done" || s.status === "skipped").length;
  return (
    <HudCard title="Stages" spotlight={false} meta={<span>{done}/{stages.length} done</span>}>
      <ol className="m-0 list-none divide-y divide-line p-0">
        {stages.map((stage, i) => {
          const status = stepStatus(stage.status);
          const pill = STEP_PILL[status];
          const totals = callTotals(stage.llm_calls);
          const tokens = totals.prompt + totals.completion;
          return (
            <li key={stage.id}>
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => onOpen(stage.id)}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none sm:flex-nowrap sm:px-5"
              >
                <span aria-hidden className="w-5 shrink-0 font-mono text-[11px] tabular-nums text-faint">{String(i + 1).padStart(2, "0")}</span>
                <span
                  aria-hidden
                  data-motion={stage.status === "running" ? "" : undefined}
                  className={cn("h-2 w-2 shrink-0 rounded-full", STEP_DOT[status])}
                />
                <span className="min-w-0 flex-1 truncate text-sm">{stage.label || STAGE_LABEL[stage.id]}</span>
                <span className="order-last w-full truncate pl-[3.25rem] font-mono text-[11px] text-faint sm:order-none sm:w-auto sm:max-w-[260px] sm:pl-0">
                  {totals.models.length ? totals.models.join(", ") : totals.calls ? "model —" : "no LLM"}
                  {tokens ? ` · ${formatCount(tokens)} tok` : ""}
                </span>
                <span className="w-14 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">{formatMs(stage.duration_ms)}</span>
                <LookPill look={pill}>{stage.status === "done" ? "done" : pill.label}</LookPill>
                {stage.error ? <span className="sr-only">Error: {stage.error.code}</span> : null}
                <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-faint" />
              </button>
            </li>
          );
        })}
      </ol>
    </HudCard>
  );
}
