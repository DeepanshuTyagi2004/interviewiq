"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils/cn";
import type { RunStep, RunStepStatus } from "@/features/observability";

/** Ordered step list for a run; each step expands to show its full-transparency detail. */
export function RunTimeline({ steps }: { steps: RunStep[] }) {
  const [open, setOpen] = React.useState<Set<string>>(new Set());

  const toggle = (name: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <ol className="space-y-2">
      {steps.map((step) => {
        const hasDetail = step.detail && Object.keys(step.detail).length > 0;
        const isOpen = open.has(step.name);
        return (
          <li key={step.name} className="rounded-xl border border-border bg-card">
            <button
              type="button"
              onClick={() => hasDetail && toggle(step.name)}
              className={cn(
                "flex w-full items-center gap-3 px-4 py-3 text-left",
                hasDetail ? "cursor-pointer" : "cursor-default",
              )}
              aria-expanded={isOpen}
            >
              <StatusDot status={step.status} />
              <span className="flex-1 font-medium">{prettyName(step.name)}</span>
              {step.duration_ms != null && (
                <span className="tabular-nums text-xs text-muted-foreground">
                  {formatDuration(step.duration_ms)}
                </span>
              )}
              <StatusBadge status={step.status} />
              {hasDetail && (
                <span className="ml-1 text-xs text-muted-foreground">{isOpen ? "▾" : "▸"}</span>
              )}
            </button>
            {isOpen && hasDetail && (
              <div className="space-y-3 border-t border-border px-4 py-3">
                {Object.entries(step.detail).map(([key, value]) => (
                  <DetailField key={key} label={key} value={value} />
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function DetailField({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="space-y-1">
      <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <DetailValue value={value} />
    </div>
  );
}

function DetailValue({ value }: { value: unknown }) {
  if (value == null) return <p className="text-sm text-muted-foreground">—</p>;
  if (typeof value === "object") {
    return (
      <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  const str = String(value);
  if (str.length > 120 || str.includes("\n")) {
    return (
      <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs whitespace-pre-wrap">
        {str}
      </pre>
    );
  }
  return <p className="font-mono text-sm">{str}</p>;
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
