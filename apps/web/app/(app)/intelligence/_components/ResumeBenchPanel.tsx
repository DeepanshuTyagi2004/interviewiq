"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, FormField } from "@/components/patterns";
import { ConsoleCard } from "@/components/observability/ConsoleCard";
import { RunConsole } from "@/components/observability/RunConsole";
import { useResumeRun, useStartResumeRun } from "@/features/resume-bench";

/** File input styled to match the console: an outlined "Choose file" chip, muted file name. */
const FILE_INPUT_CLASS =
  "block w-full min-w-0 rounded-md text-[13px] text-muted-foreground file:mr-3 file:h-8 file:cursor-pointer file:rounded-md file:border file:border-solid file:border-line-3 file:bg-card file:px-3 file:text-[13px] file:text-foreground file:transition-colors hover:file:border-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/**
 * Admin test-bench for the resume-parse pipeline: upload a PDF, start an instrumented run, and
 * watch every step (extract → prompt → LLM response → validate → final draft) with live logs.
 */
export function ResumeBenchPanel() {
  const [file, setFile] = React.useState<File | null>(null);
  const [runId, setRunId] = React.useState<string | null>(null);
  const start = useStartResumeRun();
  const run = useResumeRun(runId);
  const inputId = React.useId();

  const onStart = () => {
    if (!file) return;
    start.mutate(file, { onSuccess: (res) => setRunId(res.run_id) });
  };

  return (
    <div className="space-y-4">
      <ConsoleCard title="Run a parse">
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end sm:p-5">
          <FormField label="Resume (PDF)" htmlFor={inputId} className="min-w-0 sm:max-w-sm sm:flex-1">
            <input
              id={inputId}
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className={FILE_INPUT_CLASS}
            />
          </FormField>
          <Button onClick={onStart} disabled={!file || start.isPending} className="self-start sm:self-auto">
            {start.isPending ? "Starting…" : "Run parse"}
          </Button>
        </div>
        {start.isError && (
          <p role="alert" className="m-0 border-t border-line px-4 py-3 text-sm text-destructive sm:px-5">
            {(start.error as Error).message}
          </p>
        )}
      </ConsoleCard>

      {run.data ? (
        <RunConsole snapshot={run.data} resultTitle="Parsed profile (draft)" />
      ) : runId ? (
        <p className="m-0 text-sm text-muted-foreground">Starting run…</p>
      ) : (
        <EmptyState
          title="No run yet"
          hint="Upload a PDF resume and hit “Run parse” to watch the pipeline execute step by step."
        />
      )}
    </div>
  );
}
