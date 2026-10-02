"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { RunStep } from "@/features/observability";
import { LookPill } from "./ConsoleCard";
import { STEP_DOT, STEP_PILL, formatDuration, prettyStepName } from "./status";

/**
 * Ordered step list for a run, as hairline rows (sits inside a card). A step with detail expands
 * to show its full-transparency payload; one without detail is a plain row.
 */
export function RunTimeline({ steps }: { steps: RunStep[] }) {
  const [open, setOpen] = React.useState<Set<string>>(new Set());
  const baseId = React.useId();

  const toggle = (name: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  if (steps.length === 0) {
    return <p className="m-0 px-4 py-6 text-sm text-muted-foreground sm:px-5">No steps reported yet.</p>;
  }

  return (
    <ol className="m-0 list-none divide-y divide-line p-0">
      {steps.map((step) => {
        const hasDetail = step.detail && Object.keys(step.detail).length > 0;
        const isOpen = open.has(step.name);
        const detailId = `${baseId}-${step.name}`;
        const row = (
          <>
            <span
              aria-hidden
              data-motion={step.status === "running" ? true : undefined}
              className={cn("h-2 w-2 shrink-0 rounded-full", STEP_DOT[step.status])}
            />
            <span className="min-w-0 flex-1 truncate text-sm">{prettyStepName(step.name)}</span>
            {step.duration_ms != null ? (
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {formatDuration(step.duration_ms)}
              </span>
            ) : null}
            <LookPill look={STEP_PILL[step.status]}>{STEP_PILL[step.status].label}</LookPill>
            {hasDetail ? (
              <ChevronRight
                aria-hidden
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-faint transition-transform duration-200 ease-iq motion-reduce:transition-none",
                  isOpen && "rotate-90",
                )}
              />
            ) : (
              <span aria-hidden className="w-3.5 shrink-0" />
            )}
          </>
        );
        return (
          <li key={step.name}>
            {hasDetail ? (
              <button
                type="button"
                onClick={() => toggle(step.name)}
                aria-expanded={isOpen}
                aria-controls={isOpen ? detailId : undefined}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none sm:px-5"
              >
                {row}
              </button>
            ) : (
              <div className="flex items-center gap-3 px-4 py-3 sm:px-5">{row}</div>
            )}
            {isOpen && hasDetail ? (
              <div id={detailId} className="space-y-3 border-t border-line px-4 pb-4 pt-3 sm:px-5">
                {Object.entries(step.detail).map(([key, value]) => (
                  <DetailField key={key} label={key} value={value} />
                ))}
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function DetailField({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="space-y-1.5">
      <p className="iq-eyebrow m-0">{label}</p>
      <DetailValue label={label} value={value} />
    </div>
  );
}

const PRE =
  "m-0 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-[11px] bg-panel p-3 font-mono text-xs leading-relaxed [scrollbar-width:thin] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function DetailValue({ label, value }: { label: string; value: unknown }) {
  if (value == null) return <p className="m-0 text-sm text-faint">—</p>;
  if (typeof value === "object") {
    return (
      <pre tabIndex={0} role="region" aria-label={label} className={PRE}>
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  const str = String(value);
  if (str.length > 120 || str.includes("\n")) {
    return (
      <pre tabIndex={0} role="region" aria-label={label} className={PRE}>
        {str}
      </pre>
    );
  }
  return <p className="m-0 font-mono text-[13px] [overflow-wrap:anywhere]">{str}</p>;
}
