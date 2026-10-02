"use client";

import { StatusDot } from "@/components/hud";
import type { RunSnapshot, RunStatus } from "@/features/observability";
import { ConsoleCard } from "./ConsoleCard";
import { RunLogStream } from "./RunLogStream";
import { RunTimeline } from "./RunTimeline";
import { runDotState } from "./status";

/**
 * Full-transparency view of one pipeline run: a card with the run header (label, run id, status),
 * any error and the expandable step timeline; then the live log stream and the final artifact.
 * Pipeline-agnostic — both the resume and interview-prep consoles render this with their own run.
 */
export function RunConsole({
  snapshot,
  resultTitle = "Final result",
}: {
  snapshot: RunSnapshot;
  resultTitle?: string;
}) {
  const hasResult = snapshot.result != null;
  return (
    <div className="space-y-3">
      <ConsoleCard
        aria-label={`Run ${snapshot.label}`}
        title={
          // The run label and id are data, not a section label: keep their case (ids are case-sensitive).
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate font-sans text-[15px] normal-case tracking-[-0.01em] text-foreground">
              {snapshot.label}
            </span>
            <span className="truncate font-mono text-[11.5px] normal-case tracking-normal text-faint">
              {snapshot.run_id}
            </span>
          </span>
        }
        meta={<RunStatusDot status={snapshot.status} currentStep={snapshot.current_step} />}
      >
        {snapshot.error ? (
          <div role="alert" className="border-b border-line bg-destructive/[0.06] px-4 py-3 text-sm sm:px-5">
            <span className="text-destructive">
              Failed{snapshot.error.step ? ` at ${snapshot.error.step}` : ""}
            </span>
            {snapshot.error.message ? (
              <p className="m-0 mt-1 font-mono text-xs text-foreground [overflow-wrap:anywhere]">
                {snapshot.error.message}
              </p>
            ) : null}
          </div>
        ) : null}
        <p className="iq-eyebrow m-0 px-4 pb-1 pt-4 sm:px-5">
          Steps · <span className="tabular-nums">{snapshot.steps.length}</span>
        </p>
        <RunTimeline steps={snapshot.steps} />
      </ConsoleCard>

      <div className={hasResult ? "grid grid-cols-1 gap-3 xl:grid-cols-2 xl:items-start" : undefined}>
        <RunLogStream logs={snapshot.logs} />
        {hasResult ? (
          <ConsoleCard title={resultTitle}>
            <pre
              tabIndex={0}
              role="region"
              aria-label={resultTitle}
              className="m-0 max-h-[32rem] overflow-auto whitespace-pre-wrap break-words bg-panel p-4 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring sm:px-5"
            >
              {JSON.stringify(snapshot.result, null, 2)}
            </pre>
          </ConsoleCard>
        ) : null}
      </div>
    </div>
  );
}

/** The run's state as a HUD status dot + mono label (same words as before). Pulses only while running. */
function RunStatusDot({ status, currentStep }: { status: RunStatus; currentStep: string | null }) {
  const label =
    status === "running" ? `Running${currentStep ? ` · ${currentStep}` : ""}` : status === "failed" ? "Failed" : "Completed";
  return (
    <StatusDot
      state={runDotState(status)}
      label={label}
      className={status === "running" ? "text-foreground" : status === "failed" ? "text-destructive" : undefined}
    />
  );
}
