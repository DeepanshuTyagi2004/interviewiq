"use client";

import * as React from "react";
import { MonoPill } from "@/components/patterns";
import { CardEmpty, LookPill } from "@/components/observability/ConsoleCard";
import { STEP_DOT, STEP_PILL, formatDuration, prettyStepName } from "@/components/observability/status";
import { cn } from "@/lib/utils/cn";
import type { AgentStep, AgentTurn } from "@/features/agent-diagnostics";

/**
 * Renders the decision trail for an agent session: one block per turn, each
 * listing its steps in order. Skipped steps are muted rather than hidden so
 * the branch structure of the run stays visible (e.g. "clarify" skipped in
 * favor of "advance"). `detail.branch_reason`, when present, is surfaced
 * inline next to the step's status. Steps are buttons when selectable.
 */
export function DecisionTimeline({
  turns,
  onSelectStep,
}: {
  turns: AgentTurn[];
  onSelectStep?: (turnIndex: number, stepIndex: number) => void;
}) {
  if (turns.length === 0) {
    return <CardEmpty title="No turns yet." />;
  }

  return (
    <ol className="m-0 list-none divide-y divide-line p-0">
      {turns.map((turn) => (
        <li key={turn.index} className="px-2 py-3 sm:px-3">
          <div className="mb-1.5 flex flex-wrap items-center gap-2 px-2">
            <h3 className="m-0 text-sm font-normal">
              Turn <span className="font-mono tabular-nums">{turn.index}</span>
            </h3>
            <MonoPill tone="soft">{turn.kind}</MonoPill>
            <span className="font-mono text-[11.5px] tabular-nums text-faint">
              {turn.elapsed_s_at_turn}s elapsed
            </span>
          </div>
          <ol className="m-0 list-none space-y-px p-0">
            {turn.steps.map((step, stepIndex) => (
              <li key={`${step.name}-${stepIndex}`}>
                {onSelectStep ? (
                  <button
                    type="button"
                    onClick={() => onSelectStep(turn.index, stepIndex)}
                    className={cn(ROW, "w-full text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring")}
                  >
                    <StepRow step={step} />
                  </button>
                ) : (
                  <div className={ROW}>
                    <StepRow step={step} />
                  </div>
                )}
              </li>
            ))}
          </ol>
        </li>
      ))}
    </ol>
  );
}

const ROW = "flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-[9px] px-2 py-1.5 text-[13px]";

function StepRow({ step }: { step: AgentStep }) {
  const skipped = step.status === "skipped";
  const branchReason = step.detail?.branch_reason;
  return (
    <>
      <span
        aria-hidden
        data-motion={step.status === "running" ? true : undefined}
        className={cn("h-2 w-2 shrink-0 rounded-full", STEP_DOT[step.status])}
      />
      <span className={cn(skipped ? "text-faint" : "text-foreground")}>{prettyStepName(step.name)}</span>
      <LookPill look={STEP_PILL[step.status]} className={cn(skipped && "opacity-70")}>
        {STEP_PILL[step.status].label}
      </LookPill>
      {step.duration_ms != null && (
        <span className="font-mono text-[11.5px] tabular-nums text-muted-foreground">
          {formatDuration(step.duration_ms)}
        </span>
      )}
      {branchReason != null && (
        <em className="text-xs not-italic text-muted-foreground">· {String(branchReason)}</em>
      )}
    </>
  );
}
