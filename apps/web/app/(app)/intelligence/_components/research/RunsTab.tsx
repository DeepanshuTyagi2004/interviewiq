"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { HudEmpty } from "@/components/hud";
import { Button } from "@/components/ui/button";
import { ApiFetchError } from "@/lib/api-client/client";
import {
  buildSpanTree, copyText, deepLinkHref, deepestErrorSpan, formatFailureReport, getSpan, isRunActive, nodeSpansFor,
  parseDeepLink, useResearchRun, useResearchRuns, useRunEvents, useRunSpans,
  type ResearchItem, type ResearchSpan,
} from "@/features/research";
import { BudgetMeters } from "./BudgetMeters";
import { LiveConsole } from "./LiveConsole";
import { RunControlBar } from "./RunControlBar";
import { SpanDetail } from "./SpanDetail";
import { TraceTree } from "./TraceTree";

/** Intelligence → Runs: the research debugger (spec §9.1). Every selection lives in the URL. */
export function RunsTab() {
  const params = useSearchParams();
  const router = useRouter();
  const link = parseDeepLink(params);
  const runs = useResearchRuns();
  const runId = link.run ?? runs.data?.runs[0]?.run_id ?? null;
  const detail = useResearchRun(runId);
  const run = detail.data?.run;
  const items = React.useMemo(() => detail.data?.items ?? [], [detail.data]);
  const live = run ? isRunActive(run.status) : false;
  const spans = useRunSpans(runId, live);
  const roots = React.useMemo(() => buildSpanTree(spans.data?.spans ?? []), [spans.data]);
  const events = useRunEvents(runId, { live, lastSeq: run?.last_seq });

  // When the run stops being live, the polls stop too: fetch the final spans and event tail once.
  const prev = React.useRef<{ runId: string | null; live: boolean }>({ runId: null, live: false });
  const lastSeq = run?.last_seq;
  const { refetch: refetchSpans } = spans;
  const { refetch: refetchEvents } = events;
  React.useEffect(() => {
    // Same run, live -> done, and its detail is loaded. Never on a run switch: the events query
    // needs last_seq to open at the newest rows, and a manual refetch would otherwise scan from seq 0.
    if (prev.current.runId === runId && prev.current.live && !live && lastSeq !== undefined) {
      void refetchSpans();
      void refetchEvents();
    }
    prev.current = { runId, live };
  }, [runId, live, lastSeq, refetchSpans, refetchEvents]);

  // Always pin the resolved run so a newer run appearing later cannot swap the trace under a selected span.
  const navigate = (patch: { run?: string | null; company?: string | null; span?: string | null }) =>
    router.replace(deepLinkHref(new URLSearchParams(params.toString()), { tab: "runs", run: runId, ...patch }), { scroll: false });
  const pickRun = (id: string) => navigate({ run: id, company: null, span: null });

  async function loadOlder() {
    try {
      await events.loadOlder();
    } catch (e) {
      toast.error(errorText(e, "Could not load older events"));
    }
  }
  const selectSpan = (span: Pick<ResearchSpan, "span_id" | "company_id">) => navigate({ span: span.span_id, company: span.company_id });

  async function copyFailure(item: ResearchItem) {
    if (!run) return;
    try {
      const failingSpan = deepestErrorSpan(roots, item.company_id);
      const failing = failingSpan ? (await getSpan(failingSpan.span_id)).span : null;
      const okNodes = nodeSpansFor(roots, item.company_id).filter((s) => s.status === "ok");
      const previousOutputs = await Promise.all(
        okNodes.map(async (s) => ({ node: s.name, output: (await getSpan(s.span_id)).span.output ?? null })),
      );
      const logs = events.events.filter((e) => e.company_id === item.company_id).slice(-200);
      await copyText(formatFailureReport({ run, item, failing, previousOutputs, logs }), "Failure report copied");
    } catch {
      toast.error("Could not build the failure report");
    }
  }

  if (runs.isPending) return <p className="m-0 text-[13px] text-muted-foreground">Loading research runs…</p>;
  if (runs.isError && !runs.data) return <ErrorLine>Could not load research runs: {errorText(runs.error, "unknown error")}</ErrorLine>;
  const runsError = runs.isError ? <ErrorLine>Could not refresh research runs: {errorText(runs.error, "unknown error")}</ErrorLine> : null;

  if (!runId) {
    return (
      <div className="flex flex-col gap-4">
        {runsError}
        <RunControlBar runs={[]} run={undefined} items={[]} onSelectRun={pickRun} />
        <HudEmpty title="No research runs yet" hint="Start one above, or use Research now on the Companies tab." />
      </div>
    );
  }

  if (detail.isPending) return <p className="m-0 text-[13px] text-muted-foreground">Loading run…</p>;
  if (detail.isError && !run) {
    const notFound = detail.error instanceof ApiFetchError && detail.error.status === 404;
    return (
      <div className="flex flex-col gap-3">
        <ErrorLine>{notFound ? "That run was not found." : `Could not load the run: ${errorText(detail.error, "unknown error")}`}</ErrorLine>
        <div>
          <Button size="sm" variant="strong" onClick={() => router.replace(deepLinkHref(new URLSearchParams(params.toString()), { tab: "runs", run: null, company: null, span: null }), { scroll: false })}>
            Back to latest run
          </Button>
        </div>
      </div>
    );
  }

  const companyName = link.company ? (items.find((i) => i.company_id === link.company)?.company_name ?? null) : null;

  return (
    <div className="flex flex-col gap-4">
      {runsError}
      <RunControlBar runs={runs.data?.runs ?? []} run={run} items={items} onSelectRun={pickRun} />
      {spans.isError ? <ErrorLine>Could not load the trace: {errorText(spans.error, "unknown error")}</ErrorLine> : null}
      {events.error ? <ErrorLine>Could not load events: {errorText(events.error, "unknown error")}</ErrorLine> : null}
      {run ? <BudgetMeters run={run} /> : null}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
        <TraceTree roots={roots} items={items} selectedSpanId={link.span} onSelectSpan={selectSpan} onCopyFailure={copyFailure} />
        <SpanDetail spanId={link.span} run={run} companyName={companyName} />
      </div>
      <LiveConsole
        events={events.events}
        items={items}
        live={live}
        onSelectSpan={(spanId, companyId) => navigate({ span: spanId, company: companyId })}
        canLoadOlder={events.canLoadOlder}
        onLoadOlder={loadOlder}
        loadingOlder={events.loadingOlder}
      />
    </div>
  );
}

function errorText(e: unknown, fallback: string): string {
  return e instanceof ApiFetchError ? e.message : fallback;
}

function ErrorLine({ children }: { children: React.ReactNode }) {
  return <p role="alert" className="m-0 text-[13px] text-destructive">{children}</p>;
}
