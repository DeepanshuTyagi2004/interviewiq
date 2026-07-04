"use client";

import { useState } from "react";
import { ListChecks, Play, RotateCw, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatRow, StatTile, SectionLabel } from "@/components/patterns";
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

const STATUS_VARIANT: Record<RunStatus, "default" | "secondary" | "destructive" | "outline"> = {
  running: "default",
  completed: "secondary",
  failed: "destructive",
  cancelled: "outline",
  idle: "outline",
};

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
    <div className="space-y-6">
      {/* status + run button */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Badge variant={STATUS_VARIANT[status]} className="uppercase tracking-wide">
            {status}
          </Badge>
          {data?.stage ? (
            <span className="text-sm text-muted-foreground">
              stage: <span className="font-mono">{data.stage}</span>
            </span>
          ) : null}
          {data?.trigger ? (
            <span className="text-xs text-muted-foreground">via {data.trigger}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="text-destructive hover:text-destructive"
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
            <Trash2 className="size-4" /> {clear.isPending ? "Clearing…" : "Clear briefs"}
          </Button>
          {running ? (
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
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
              <Square className="size-4" /> {stop.isPending ? "Stopping…" : "Stop"}
            </Button>
          ) : null}
          <Button
            onClick={() => runMutation(trigger, "Ingestion started.")}
            disabled={busy}
            title="Generate the per-JD round-by-round interview brief: Perplexity gathers real experiences, the local LLM consolidates them"
          >
            {running ? (
              <>
                <RotateCw className="size-4 animate-spin" /> Running…
              </>
            ) : (
              <>
                <Play className="size-4" /> Run ingestion
              </>
            )}
          </Button>
          <Button
            variant="secondary"
            onClick={() => runMutation(collect, "Collecting question sets…")}
            disabled={busy}
            title="Collect DSA / System-Design / LLD interview questions from public sources into the bank"
          >
            <ListChecks className="size-4" /> Collect questions
          </Button>
        </div>
      </div>

      {data?.error ? (
        <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Run failed: {data.error}
        </p>
      ) : null}

      <Counters status={data} />

      {showGenerated ? (
        <section className="space-y-2">
          <SectionLabel>Generated briefs ({generated.length})</SectionLabel>
          {briefsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading already-generated briefs…</p>
          ) : generated.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No briefs generated yet. Click “Run ingestion” to create the per-JD round-by-round briefs;
              the live prompts, responses, citations and stored documents appear here.
            </p>
          ) : (
            <div className="space-y-2">
              {generated.map((b) => {
                const key = `${b.company}/${b.role}/${b.level}/${b.specialization}`;
                return (
                  <GeneratedBriefCard
                    key={key}
                    summary={b}
                    open={openKey === key}
                    onToggle={() => toggle(key)}
                  />
                );
              })}
            </div>
          )}
        </section>
      ) : (
        <section className="space-y-2">
          <SectionLabel>Combinations ({combos.length})</SectionLabel>
          <div className="space-y-2">
            {combos.map((c) => (
              <ComboDetailCard
                key={c.combo}
                detail={c}
                open={openKey === c.combo}
                onToggle={() => toggle(c.combo)}
              />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <SectionLabel>Live logs</SectionLabel>
          {isLoading ? <span className="text-xs text-muted-foreground">Connecting…</span> : null}
        </div>
        <LogStream logs={data?.logs ?? []} />
      </section>
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
