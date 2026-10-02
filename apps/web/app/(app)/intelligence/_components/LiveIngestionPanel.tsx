"use client";

import { useState } from "react";
import { ListChecks, Play, RotateCw, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot, padCount } from "@/components/hud";
import { StatRow, StatTile } from "@/components/patterns";
import { CardEmpty, ConsoleCard, HeaderCount } from "@/components/observability/ConsoleCard";
import {
  useBriefs,
  useClearBriefs,
  useScrapeStatus,
  useStopScrape,
  useTriggerCollect,
  useTriggerScrape,
} from "@/features/intelligence";
import type { RunStatus, ScrapeStatus } from "@/features/intelligence";
import { ApiFetchError } from "@/lib/api-client/client";
import { LogStream } from "./LogStream";
import { ComboDetailCard } from "./ComboDetailCard";
import { GeneratedBriefCard } from "./GeneratedBriefCard";
import { RUN_STATUS_DOT } from "./pills";

export function LiveIngestionPanel() {
  const { data, isLoading } = useScrapeStatus();
  const trigger = useTriggerScrape();
  const collect = useTriggerCollect();
  const stop = useStopScrape();
  const clear = useClearBriefs();

  const status: RunStatus = data?.status ?? "idle";
  const running = status === "running";
  const busy = running || trigger.isPending || collect.isPending;

  function runMutation(
    mutation: typeof trigger,
    startedMsg: string,
  ) {
    mutation.mutate(undefined, {
      onSuccess: (res) => {
        toast.success(
          res.already_running
            ? "A run is already in progress — showing its live progress."
            : startedMsg,
        );
      },
      onError: (err) => {
        const message =
          err instanceof ApiFetchError && err.code === "ai_service_unreachable"
            ? "The intelligence service is not reachable. Is it running?"
            : "Could not start the run.";
        toast.error(message);
      },
    });
  }

  const combos = data?.combos ?? [];
  // Single-open accordion (one card expanded at a time). When there's no live run,
  // fall back to the already-generated briefs persisted in Mongo.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const toggle = (key: string) => setOpenKey((cur) => (cur === key ? null : key));

  const briefsQuery = useBriefs();
  const generated = briefsQuery.data?.briefs ?? [];
  const showGenerated = combos.length === 0;

  return (
    <div className="space-y-4">
      {/* status + run controls */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px]">
          {/* Pulses only while a run is really in flight. */}
          <StatusDot
            state={RUN_STATUS_DOT[status] ?? "idle"}
            label={status}
            className={status === "failed" ? "text-destructive" : running ? "text-foreground" : "text-muted-foreground"}
          />
          {data?.stage ? (
            <span className="text-muted-foreground">
              stage <span className="font-mono text-foreground">{data.stage}</span>
            </span>
          ) : null}
          {data?.trigger ? (
            <span className="text-faint">
              via <span className="font-mono">{data.trigger}</span>
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="text-destructive hover:border-destructive hover:text-destructive"
            disabled={busy || clear.isPending}
            onClick={() => {
              if (!window.confirm("Delete ALL generated briefs from MongoDB? The catalogue is kept. This can't be undone.")) return;
              clear.mutate(undefined, {
                onSuccess: (r) => toast.success(`Cleared ${r.deleted} brief(s).`),
                onError: () => toast.error("Could not clear briefs."),
              });
            }}
            title="Delete all generated interview briefs (MongoDB). The JD catalogue is untouched."
          >
            <Trash2 aria-hidden /> {clear.isPending ? "Clearing…" : "Clear briefs"}
          </Button>
          {running ? (
            <Button
              variant="outline"
              className="text-destructive hover:border-destructive hover:text-destructive"
              disabled={stop.isPending}
              onClick={() =>
                stop.mutate(undefined, {
                  onSuccess: (r) =>
                    toast.success(r.stopping ? "Stopping after the current JD…" : "Nothing is running."),
                  onError: () => toast.error("Could not stop the run."),
                })
              }
              title="Stop the run — it halts after the current JD finishes"
            >
              <Square aria-hidden /> {stop.isPending ? "Stopping…" : "Stop"}
            </Button>
          ) : null}
          <Button
            variant="strong"
            onClick={() => runMutation(collect, "Collecting question sets…")}
            disabled={busy}
            title="Collect DSA / System-Design / LLD interview questions from public sources into the bank"
          >
            <ListChecks aria-hidden /> Collect questions
          </Button>
          <Button
            onClick={() => runMutation(trigger, "Ingestion started.")}
            disabled={busy}
            title="Generate the per-JD round-by-round interview brief: Perplexity gathers real experiences, the local LLM consolidates them"
          >
            {running ? (
              <>
                <RotateCw aria-hidden className="animate-spin motion-reduce:animate-none" /> Running…
              </>
            ) : (
              <>
                <Play aria-hidden /> Run ingestion
              </>
            )}
          </Button>
        </div>
      </div>

      {data?.error ? (
        <p role="alert" className="m-0 rounded-[14px] bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Run failed: <span className="font-mono text-[13px]">{data.error}</span>
        </p>
      ) : null}

      <Counters status={data} />

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] xl:items-start">
        {showGenerated ? (
          <ConsoleCard
            title="Generated briefs"
            meta={<HeaderCount>{padCount(generated.length)} {generated.length === 1 ? "brief" : "briefs"}</HeaderCount>}
          >
            {briefsQuery.isLoading ? (
              <div className="space-y-2 p-4 sm:px-5" aria-busy="true" aria-label="Loading already-generated briefs">
                {Array.from({ length: 3 }, (_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : generated.length === 0 ? (
              <CardEmpty
                title="No briefs generated yet"
                hint="Click “Run ingestion” to create the per-JD round-by-round briefs; the live prompts, responses, citations and stored documents appear here."
              />
            ) : (
              <ul className="m-0 list-none divide-y divide-line p-0">
                {generated.map((b) => {
                  const key = `${b.company}/${b.role}/${b.level}/${b.specialization}`;
                  return (
                    <li key={key}>
                      <GeneratedBriefCard summary={b} open={openKey === key} onToggle={() => toggle(key)} />
                    </li>
                  );
                })}
              </ul>
            )}
          </ConsoleCard>
        ) : (
          <ConsoleCard
            title="Combinations"
            meta={<HeaderCount>{padCount(combos.length)} in this run</HeaderCount>}
          >
            <ul className="m-0 list-none divide-y divide-line p-0">
              {combos.map((c) => (
                <li key={c.combo}>
                  <ComboDetailCard detail={c} open={openKey === c.combo} onToggle={() => toggle(c.combo)} />
                </li>
              ))}
            </ul>
          </ConsoleCard>
        )}

        <LogStream
          logs={data?.logs ?? []}
          meta={isLoading ? "Connecting…" : undefined}
          className="h-96 xl:sticky xl:top-[68px] xl:h-[min(34rem,calc(100vh/var(--hud-zoom,1)-15rem))]"
        />
      </div>
    </div>
  );
}

function Counters({ status }: { status: ScrapeStatus | undefined }) {
  const get = (key: string) => status?.stages?.brief_generation?.[key] ?? 0;
  return (
    <StatRow className="sm:grid-cols-2 lg:grid-cols-4">
      <StatTile value={get("success")} label="Briefs generated" />
      <StatTile value={get("insufficient_data")} label="Low-data briefs" />
      <StatTile value={get("failed")} label="Failed" />
      <StatTile value={get("skipped")} label="Skipped (fresh)" />
    </StatRow>
  );
}
