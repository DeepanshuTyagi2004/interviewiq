"use client";

import { Loader2, RotateCcw } from "lucide-react";
import { HudCard, HudEmpty, StatusDot } from "@/components/hud";
import { Button } from "@/components/ui/button";
import {
  useEvaluationRun,
  useRerunEvaluation,
  type Disagreement,
  type EvaluationArithmetic,
  type EvaluationRunDetail as RunDetail,
  type PartGrade,
} from "@/features/evaluations-admin";
import { timeAgo } from "@/features/research";
import { ApiFetchError } from "@/lib/api-client/client";
import { cn } from "@/lib/utils/cn";
import { formatMs } from "../prep/format";
import { CopyButton, ErrorBox, Facts, Section } from "../prep/ui";
import { EVALUATION_RUN_DOT, evaluationRunTitle } from "./EvaluationRunList";

const show = (v: unknown): string => (v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** How many grader outputs a run holds: one model call per grader and part (the AI service keeps no other call log). */
export function graderCallCount(run: Pick<RunDetail, "raw">): number {
  return Object.values(run.raw?.graders ?? {}).reduce((n, by) => n + Object.keys(by).length, 0);
}

/** Right pane: header and re-run, disagreements and tiebreaks, graders A/B per part, final arithmetic. */
export function EvaluationRunDetail({ runId, onSelectRun }: { runId: string | null; onSelectRun: (id: string) => void }) {
  const q = useEvaluationRun(runId);
  const rerun = useRerunEvaluation();
  const run = q.data;

  if (!runId) {
    return (
      <HudCard title="Run" spotlight={false}>
        <HudEmpty title="Pick a run" hint="Select a run on the left to see how its round was graded." />
      </HudCard>
    );
  }
  if (q.isPending) {
    return (
      <HudCard title="Run" spotlight={false} bodyClassName="px-4 py-4 sm:px-5">
        <p className="m-0 text-[13px] text-muted-foreground">Loading run…</p>
      </HudCard>
    );
  }
  if (!run) {
    const notFound = q.error instanceof ApiFetchError && q.error.status === 404;
    return (
      <HudCard title="Run" spotlight={false} bodyClassName="px-4 py-4 sm:px-5">
        <p role="alert" className="m-0 text-[13px] text-destructive">
          {notFound ? "That run was not found. It may have expired." : `Could not load the run: ${q.error instanceof ApiFetchError ? q.error.message : "unknown error"}`}
        </p>
      </HudCard>
    );
  }

  const err = rerun.error;
  const parts = Object.entries(run.raw?.graders ?? {});
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <HudCard
        spotlight={false}
        aria-label={`Run ${run.run_id}`}
        title={
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate font-sans text-[15px] normal-case tracking-[-0.01em] text-foreground">{evaluationRunTitle(run)}</span>
            <span className="truncate font-mono text-[11.5px] normal-case tracking-normal text-faint">{run.run_id}</span>
          </span>
        }
        meta={<StatusDot state={EVALUATION_RUN_DOT[run.status]} label={run.status} className={cn(run.status === "failed" && "text-destructive")} />}
        bodyClassName="space-y-4 px-4 py-4 sm:px-5"
      >
        {run.error ? <ErrorBox code={run.error.code} message={run.error.message} /> : null}
        <Facts
          className="sm:grid-cols-[max-content_minmax(0,1fr)_max-content_minmax(0,1fr)]"
          items={[
            ["Trigger", run.trigger],
            ["Created", <time key="c" dateTime={run.created_at} title={run.created_at}>{timeAgo(run.created_at)}</time>],
            ["Duration", formatMs(run.duration_ms)],
            ["Calls", String(graderCallCount(run))],
            ["Outcome", run.outcome ?? "—"],
            ["Score", run.result?.score != null ? (run.result.pass_mark != null ? `${run.result.score.toFixed(1)} / ${run.result.pass_mark.toFixed(1)}` : run.result.score.toFixed(1)) : "—"],
            ["Disagreements", String(run.raw?.disagreements?.length ?? 0)],
            ["Eval version", run.eval_version ?? "—"],
            ["Session", run.session_id ?? "—"],
          ]}
        />
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Button
            type="button"
            size="sm"
            variant="strong"
            disabled={rerun.isPending || !run.session_id || run.status === "running"}
            onClick={() => rerun.mutate(run.session_id!, { onSuccess: (r) => onSelectRun(r.runId) })}
          >
            {rerun.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <RotateCcw aria-hidden />}
            Re-run
          </Button>
          <CopyButton className="ml-auto" text={JSON.stringify(run, null, 2)} what="Run JSON copied" label="Copy JSON" />
        </div>
        {err ? (
          <ErrorBox
            code={err instanceof ApiFetchError ? (err.code ?? `HTTP ${err.status}`) : "rerun_failed"}
            message={err instanceof Error ? err.message : "Could not start the re-run."}
          />
        ) : null}
      </HudCard>

      {run.raw ? <Disagreements items={run.raw.disagreements} /> : null}
      {parts.map(([partId, by]) => (
        <HudCard key={partId} title={`Part ${partId}`} spotlight={false} bodyClassName="grid gap-px bg-line md:grid-cols-2">
          {(["A", "B"] as const).map((g) => <GraderColumn key={g} label={`Grader ${g}`} grade={by[g]} />)}
          {by.C ? <div className="md:col-span-2"><GraderColumn label="Tiebreak (grader C)" grade={by.C} /></div> : null}
        </HudCard>
      ))}
      {run.arithmetic ? <Arithmetic a={run.arithmetic} /> : null}
    </div>
  );
}

function Disagreements({ items }: { items: Disagreement[] }) {
  return (
    <HudCard title="Disagreements and tiebreaks" spotlight={false} bodyClassName="px-0 py-0">
      {items.length === 0 ? (
        <p className="m-0 px-4 py-3 text-[13px] text-muted-foreground sm:px-5">Graders A and B agreed everywhere. No tiebreak was needed.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-left text-[12.5px]">
            <thead>
              <tr className="font-mono text-[11px] uppercase tracking-[0.06em] text-faint">
                {["Part", "Field", "A", "B", "C (tiebreak)", "Final"].map((h) => <th key={h} className="px-4 py-2 font-normal first:sm:pl-5">{h}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line font-mono tabular-nums">
              {items.map((d, i) => (
                <tr key={i}>
                  <td className="px-4 py-2 [overflow-wrap:anywhere] sm:pl-5">{d.part_id}</td>
                  <td className="px-4 py-2 [overflow-wrap:anywhere]">{d.field}</td>
                  <td className="px-4 py-2">{show(d.a)}</td>
                  <td className="px-4 py-2">{show(d.b)}</td>
                  <td className="px-4 py-2">{show(d.c)}</td>
                  <td className="px-4 py-2">{show(d.merged)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </HudCard>
  );
}

function GraderColumn({ label, grade }: { label: string; grade: PartGrade | undefined }) {
  return (
    <div className="min-w-0 space-y-3 bg-card px-4 py-4 sm:px-5">
      <h4 className="iq-eyebrow m-0">{label}</h4>
      {!grade ? (
        <p className="m-0 text-xs text-faint">No output.</p>
      ) : (
        <>
          <p className="m-0 font-mono text-[12px] text-muted-foreground">Must-have met: {grade.must_have_met == null ? "—" : grade.must_have_met ? "yes" : "no"}</p>
          {grade.areas?.length ? (
            <Section title="Areas">
              <ul className="m-0 list-none space-y-1.5 p-0 text-[12.5px]">
                {grade.areas.map((a) => (
                  <li key={a.key}>
                    <span className="font-mono tabular-nums">{a.score.toFixed(1)}</span> <span>{a.key}</span>
                    {a.reason ? <span className="block text-faint [overflow-wrap:anywhere]">{a.reason}</span> : null}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          {grade.questions?.length ? (
            <Section title="Questions">
              <ul className="m-0 list-none space-y-1.5 p-0 text-[12.5px]">
                {grade.questions.map((qn) => (
                  <li key={qn.id}>
                    <span className="font-mono tabular-nums">{qn.score.toFixed(1)}</span> <span className="font-mono">{qn.id}</span>
                    {qn.verdict ? <span className="text-faint"> · {qn.verdict}</span> : null}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
          {grade.code ? (
            <Section title="Code">
              <p className="m-0 font-mono text-[12px]">logic works: {grade.code.logic_works ?? "—"} · complexity: {grade.code.actual_complexity ?? "—"}</p>
            </Section>
          ) : null}
        </>
      )}
    </div>
  );
}

function Arithmetic({ a }: { a: EvaluationArithmetic }) {
  return (
    <HudCard title="Arithmetic" spotlight={false} bodyClassName="space-y-4 px-4 py-4 sm:px-5">
      <Facts
        className="sm:grid-cols-[max-content_minmax(0,1fr)_max-content_minmax(0,1fr)]"
        items={[
          ["Base", show(a.base)],
          ["Bonus", show(a.bonus_total)],
          ["Penalty", show(a.penalty_total)],
          ["Cap", show(a.cap)],
          ["Score", show(a.score)],
          ["Pass mark", show(a.pass_mark)],
          ["Verdict", show(a.verdict)],
          ["Main family", show(a.main_family)],
          ["Auto fail", a.auto_fail ? (a.auto_fail_reason ? `yes · ${a.auto_fail_reason}` : "yes") : "no"],
        ]}
      />
      {a.parts?.length ? (
        <Section title="Parts">
          <ul className="m-0 list-none space-y-1 p-0 font-mono text-[12px] [overflow-wrap:anywhere]">
            {a.parts.map((p, i) => <li key={i}>{show(p)}</li>)}
          </ul>
        </Section>
      ) : null}
      {a.adjustments?.length ? (
        <Section title="Adjustments">
          <ul className="m-0 list-none space-y-1 p-0 font-mono text-[12px] [overflow-wrap:anywhere]">
            {a.adjustments.map((x, i) => <li key={i}>{show(x)}</li>)}
          </ul>
        </Section>
      ) : null}
    </HudCard>
  );
}
