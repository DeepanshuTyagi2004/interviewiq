"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/patterns";
import { RunConsole } from "@/components/observability/RunConsole";
import { useJds } from "@/features/jobs";
import { usePrepCandidates, usePrepRun, useStartPrepRun } from "@/features/interview-prep-bench";

const SELECT_CLASS =
  "rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

/**
 * Admin test-bench for the interview-prep (Pipeline 1) pipeline: pick a JD + round (+ optional
 * candidate), trigger plan generation on demand (cache bypassed), and watch every stage —
 * context assembly, cache gate, persona/ladders/probes, assemble — down to the final InterviewPlan.
 */
export function InterviewPrepBenchPanel() {
  const { data: jds, isLoading: jdsLoading } = useJds();
  const { data: candidates, isLoading: candidatesLoading } = usePrepCandidates();
  const [jobDescriptionId, setJobDescriptionId] = React.useState("");
  const [candidateId, setCandidateId] = React.useState("");
  const [runId, setRunId] = React.useState<string | null>(null);
  const start = useStartPrepRun();
  const run = usePrepRun(runId);

  const canRun = Boolean(jobDescriptionId) && !start.isPending;

  const onStart = () => {
    if (!canRun) return;
    // The round isn't chosen here — the backend assigns it (the first round), same as the real flow.
    start.mutate(
      { jobDescriptionId, candidateId: candidateId.trim() || undefined },
      { onSuccess: (res) => setRunId(res.run_id) },
    );
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4 rounded-xl border border-border bg-card p-4">
        <p className="rounded-lg border border-border bg-muted p-3 text-sm text-muted-foreground">
          Interview-prep prompts are <strong className="text-foreground">v1 drafts</strong> — real
          persona, question-ladder, and candidate-probe prompts, schema-validated. They&rsquo;re
          product IP still open to tuning, so treat a generated plan as a working draft, not final
          production copy.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Job description</span>
            <select
              className={SELECT_CLASS}
              value={jobDescriptionId}
              onChange={(e) => setJobDescriptionId(e.target.value)}
            >
              <option value="">{jdsLoading ? "Loading roles…" : "Select a role"}</option>
              {(jds ?? []).map((jd) => (
                <option key={jd.id} value={jd.id}>
                  {jd.companyName} — {jd.title} ({jd.level})
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Candidate (optional)</span>
            <select
              className={SELECT_CLASS}
              value={candidateId}
              onChange={(e) => setCandidateId(e.target.value)}
            >
              <option value="">
                {candidatesLoading ? "Loading candidates…" : "No candidate (JD-only grounding)"}
              </option>
              {(candidates ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.email ? ` — ${c.email}` : ""}
                </option>
              ))}
            </select>
          </label>

          <Button onClick={onStart} disabled={!canRun}>
            {start.isPending ? "Starting…" : "Generate plan"}
          </Button>
        </div>
        {start.isError && (
          <span className="text-sm text-destructive">{(start.error as Error).message}</span>
        )}
      </div>

      {run.data ? (
        <RunConsole snapshot={run.data} resultTitle="Generated InterviewPlan" />
      ) : runId ? (
        <p className="text-sm text-muted-foreground">Starting run…</p>
      ) : (
        <EmptyState
          title="No run yet"
          hint="Pick a role and round, then “Generate plan” to watch the pipeline run end to end."
        />
      )}
    </div>
  );
}
