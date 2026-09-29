"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/patterns";
import { RunConsole } from "@/components/observability/RunConsole";
import { useResumeRun, useStartResumeRun } from "@/features/resume-bench";

/**
 * Admin test-bench for the résumé-parse pipeline: upload a PDF, start an instrumented run, and
 * watch every step (extract → prompt → LLM response → validate → final draft) with live logs.
 */
export function ResumeBenchPanel() {
  const [file, setFile] = React.useState<File | null>(null);
  const [runId, setRunId] = React.useState<string | null>(null);
  const start = useStartResumeRun();
  const run = useResumeRun(runId);

  const onStart = () => {
    if (!file) return;
    start.mutate(file, { onSuccess: (res) => setRunId(res.run_id) });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
        <input
          type="file"
          accept="application/pdf,.pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-secondary-foreground hover:file:bg-secondary/80"
        />
        <Button onClick={onStart} disabled={!file || start.isPending}>
          {start.isPending ? "Starting…" : "Run parse"}
        </Button>
        {start.isError && (
          <span className="text-sm text-destructive">{(start.error as Error).message}</span>
        )}
      </div>

      {run.data ? (
        <RunConsole snapshot={run.data} resultTitle="Parsed profile (draft)" />
      ) : runId ? (
        <p className="text-sm text-muted-foreground">Starting run…</p>
      ) : (
        <EmptyState
          title="No run yet"
          hint="Upload a PDF résumé and hit “Run parse” to watch the pipeline execute step by step."
        />
      )}
    </div>
  );
}
