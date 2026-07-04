"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RunLogStream } from "./RunLogStream";
import { RunTimeline } from "./RunTimeline";
import type { RunSnapshot, RunStatus } from "@/features/observability";

/**
 * Full-transparency view of one pipeline run: header (status + timing + error), the step timeline
 * (expandable per-step detail), the live log stream, and the final artifact. Pipeline-agnostic —
 * both the résumé and interview-prep consoles render this with their own run snapshot.
 */
export function RunConsole({
  snapshot,
  resultTitle = "Final result",
}: {
  snapshot: RunSnapshot;
  resultTitle?: string;
}) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <div className="min-w-0">
            <CardTitle className="truncate">{snapshot.label}</CardTitle>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{snapshot.run_id}</p>
          </div>
          <RunStatusBadge status={snapshot.status} currentStep={snapshot.current_step} />
        </CardHeader>
        {snapshot.error && (
          <CardContent>
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <span className="font-semibold text-destructive">
                Failed{snapshot.error.step ? ` at ${snapshot.error.step}` : ""}
              </span>
              {snapshot.error.message && (
                <p className="mt-1 font-mono text-xs text-foreground">{snapshot.error.message}</p>
              )}
            </div>
          </CardContent>
        )}
      </Card>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground">Steps</h3>
        <RunTimeline steps={snapshot.steps} />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground">Logs</h3>
        <RunLogStream logs={snapshot.logs} />
      </section>

      {snapshot.result != null && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">{resultTitle}</h3>
          <pre className="max-h-[32rem] overflow-auto rounded-xl border border-border bg-card p-4 font-mono text-xs whitespace-pre-wrap">
            {JSON.stringify(snapshot.result, null, 2)}
          </pre>
        </section>
      )}
    </div>
  );
}

function RunStatusBadge({ status, currentStep }: { status: RunStatus; currentStep: string | null }) {
  if (status === "running") {
    return (
      <Badge variant="default" className="shrink-0">
        Running{currentStep ? ` · ${currentStep}` : ""}
      </Badge>
    );
  }
  if (status === "failed") return <Badge variant="destructive" className="shrink-0">Failed</Badge>;
  return <Badge variant="secondary" className="shrink-0">Completed</Badge>;
}
