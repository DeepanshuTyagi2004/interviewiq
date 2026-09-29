"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import type { AgentTurn } from "@/features/agent-diagnostics";
import type { RunStepStatus } from "@/features/observability";

/**
 * Renders the decision trail for an agent session: one block per turn, each
 * listing its steps in order. Skipped steps are muted rather than hidden so
 * the branch structure of the run stays visible (e.g. "clarify" skipped in
 * favor of "advance"). `detail.branch_reason`, when present, is surfaced
 * inline next to the step's status.
 */
export function DecisionTimeline({
  turns,
  onSelectStep,
}: {
  turns: AgentTurn[];
  onSelectStep?: (turnIndex: number, stepIndex: number) => void;
}) {
  if (turns.length === 0) {
    return <p className="text-sm text-muted-foreground">No turns yet.</p>;
  }

  return (
    <div className="space-y-4">
      {turns.map((turn) => (
        <div key={turn.index} className="rounded-xl border border-border bg-card p-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <span>Turn {turn.index}</span>
            <Badge variant="outline">{turn.kind}</Badge>
            <span className="text-xs font-normal text-muted-foreground">
              {turn.elapsed_s_at_turn}s elapsed
            </span>
          </div>
          <ol className="ml-1 space-y-1.5">
            {turn.steps.map((step, stepIndex) => {
              const skipped = step.status === "skipped";
              const branchReason = step.detail?.branch_reason;
              const selectable = Boolean(onSelectStep);
              return (
                <li
                  key={`${step.name}-${stepIndex}`}
                  onClick={selectable ? () => onSelectStep?.(turn.index, stepIndex) : undefined}
                  className={cn(
                    "flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 text-sm",
                    skipped && "opacity-40",
                    selectable && "cursor-pointer hover:bg-muted",
                  )}
                >
                  <StatusDot status={step.status} />
                  <span className="font-medium">{prettyName(step.name)}</span>
                  <StatusBadge status={step.status} />
                  {step.duration_ms != null && (
                    <span className="tabular-nums text-xs text-muted-foreground">
                      {formatDuration(step.duration_ms)}
                    </span>
                  )}
                  {branchReason != null && (
                    <em className="text-xs not-italic text-muted-foreground">
                      · {String(branchReason)}
                    </em>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}

function StatusDot({ status }: { status: RunStepStatus }) {
  const cls: Record<RunStepStatus, string> = {
    pending: "bg-muted-foreground/30",
    running: "bg-primary animate-pulse",
    ok: "bg-emerald-500",
    failed: "bg-destructive",
    skipped: "bg-muted-foreground/30",
  };
  return <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", cls[status])} aria-hidden />;
}

function StatusBadge({ status }: { status: RunStepStatus }) {
  const label: Record<RunStepStatus, string> = {
    pending: "Pending",
    running: "Running",
    ok: "OK",
    failed: "Failed",
    skipped: "Skipped",
  };
  const variant = status === "failed" ? "destructive" : status === "ok" ? "secondary" : "outline";
  return <Badge variant={variant}>{label[status]}</Badge>;
}

function prettyName(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
