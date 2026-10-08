"use client";

import { Loader2, RotateCcw } from "lucide-react";
import { HudCard, StatusDot } from "@/components/hud";
import { LookPill } from "@/components/observability/ConsoleCard";
import { OUTLINE_PILL } from "@/components/observability/status";
import { Button } from "@/components/ui/button";
import { useRerunBlueprint, type BlueprintRunDetail } from "@/features/blueprints";
import { timeAgo } from "@/features/research";
import { ApiFetchError } from "@/lib/api-client/client";
import { cn } from "@/lib/utils/cn";
import { BLUEPRINT_RUN_DOT } from "../pills";
import { formatMs, runTitle, shortHash } from "./format";
import { CopyButton, ErrorBox, Facts } from "./ui";

/** What the run prepared, its status and failure, its identifiers, and the re-run / copy actions. */
export function RunHeader({ run, onSelectRun }: { run: BlueprintRunDetail; onSelectRun: (id: string) => void }) {
  const rerun = useRerunBlueprint();
  const inputHash = run.input_hash ?? run.request?.input_hash ?? null;
  const running = run.status === "running";

  const go = (bypassAnswerKeyCache: boolean) =>
    rerun.mutate({ id: run.run_id, bypassAnswerKeyCache }, { onSuccess: (r) => onSelectRun(r.run_id) });

  const err = rerun.error;
  return (
    <HudCard
      spotlight={false}
      aria-label={`Run ${run.run_id}`}
      title={
        // Data, not a section label: keep the case.
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-sans text-[15px] normal-case tracking-[-0.01em] text-foreground">{runTitle(run)}</span>
          <span className="truncate font-mono text-[11.5px] normal-case tracking-normal text-faint">{run.run_id}</span>
        </span>
      }
      meta={
        <StatusDot
          state={BLUEPRINT_RUN_DOT[run.status]}
          label={running && run.stage ? `running · ${run.stage}` : run.status}
          className={cn(running ? "text-foreground" : run.status === "failed" ? "text-destructive" : undefined)}
        />
      }
      bodyClassName="space-y-4 px-4 py-4 sm:px-5"
    >
      {run.error ? <ErrorBox code={run.error.code} message={run.error.message} stage={run.error.stage ?? null} /> : null}

      <Facts
        className="sm:grid-cols-[max-content_minmax(0,1fr)_max-content_minmax(0,1fr)]"
        items={[
          ["Candidate", (
            <span key="c">
              {run.candidate_label || "—"}
              {run.candidate_id ? <span className="block font-mono text-[11.5px] text-faint">{run.candidate_id}</span> : null}
            </span>
          )],
          ["Trigger", <LookPill key="t" look={OUTLINE_PILL}>{run.trigger}</LookPill>],
          ["Created", <time key="cr" dateTime={run.created_at} title={run.created_at}>{timeAgo(run.created_at)}</time>],
          ["Duration", <span key="d" className="font-mono">{formatMs(run.duration_ms)}</span>],
          ["Blueprint", run.cached ? `v${run.blueprint_version ?? "—"} · reused (cached)` : run.blueprint_version ? `v${run.blueprint_version}` : run.trigger === "bench" ? "bench (no version)" : "—"],
          ["Input hash", inputHash ? (
            <span key="h" className="inline-flex flex-wrap items-center gap-1">
              <span className="font-mono text-[12px]" title={inputHash}>{shortHash(inputHash)}</span>
              <CopyButton text={inputHash} what="Input hash copied" label="Copy" />
            </span>
          ) : "—"],
          ["Session", run.session_id ? (
            <span key="s" className="inline-flex flex-wrap items-center gap-1">
              <span className="font-mono text-[12px] [overflow-wrap:anywhere]">{run.session_id}</span>
              <CopyButton text={run.session_id} what="Session id copied" label="Copy" />
            </span>
          ) : "none (bench)"],
          ["Re-run of", run.rerun_of ? (
            <button
              key="r"
              type="button"
              onClick={() => onSelectRun(run.rerun_of!)}
              className="rounded-sm font-mono text-[12px] underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {run.rerun_of}
            </button>
          ) : "—"],
        ]}
      />

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <Button type="button" size="sm" variant="strong" disabled={rerun.isPending} onClick={() => go(false)}>
          {rerun.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <RotateCcw aria-hidden />}
          Re-run
        </Button>
        <Button type="button" size="sm" variant="strong" disabled={rerun.isPending} onClick={() => go(true)}>
          Re-run without answer-key cache
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
  );
}
