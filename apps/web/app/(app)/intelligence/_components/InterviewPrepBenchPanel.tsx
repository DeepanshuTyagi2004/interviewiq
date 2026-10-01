"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, FormField } from "@/components/patterns";
import { ConsoleCard } from "@/components/observability/ConsoleCard";
import { RunConsole } from "@/components/observability/RunConsole";
import { useJds } from "@/features/jobs";
import { usePrepCandidates, usePrepRun, useStartPrepRun } from "@/features/interview-prep-bench";
import { SELECT_CLASS } from "./fields";

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
  const ids = React.useId();

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
    <div className="space-y-4">
      <ConsoleCard title="Generate a plan">
        <div className="space-y-4 p-4 sm:p-5">
          <p className="m-0 rounded-[8px] bg-panel px-3.5 py-3 text-[13px] leading-[1.55] text-muted-foreground">
            Interview-prep prompts are <strong className="font-medium text-foreground">v1 drafts</strong>
            {" — real "}
            persona, question-ladder, and candidate-probe prompts, schema-validated. They&rsquo;re
            product IP still open to tuning, so treat a generated plan as a working draft, not final
            production copy.
          </p>
          <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end">
            <FormField label="Job description" htmlFor={`${ids}-jd`} className="min-w-0 md:w-[320px]">
              <select
                id={`${ids}-jd`}
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
            </FormField>

            <FormField label="Candidate (optional)" htmlFor={`${ids}-candidate`} className="min-w-0 md:w-[320px]">
              <select
                id={`${ids}-candidate`}
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
            </FormField>

            <Button onClick={onStart} disabled={!canRun} className="self-start md:self-auto">
              {start.isPending ? "Starting…" : "Generate plan"}
            </Button>
          </div>
          {start.isError && (
            <p role="alert" className="m-0 text-sm text-destructive">
              {(start.error as Error).message}
            </p>
          )}
        </div>
      </ConsoleCard>

      {run.data ? (
        <RunConsole snapshot={run.data} resultTitle="Generated InterviewPlan" />
      ) : runId ? (
        <p className="m-0 text-sm text-muted-foreground">Starting run…</p>
      ) : (
        <EmptyState
          title="No run yet"
          hint="Pick a role (the backend assigns the first round), then “Generate plan” to watch the pipeline run end to end."
        />
      )}
    </div>
  );
}
