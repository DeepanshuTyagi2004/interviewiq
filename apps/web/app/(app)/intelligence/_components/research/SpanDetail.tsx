"use client";

import { StatusDot } from "@/components/hud";
import { CardEmpty, ConsoleCard } from "@/components/observability/ConsoleCard";
import { LogTerminal } from "@/components/observability/LogTerminal";
import { formatDuration } from "@/components/observability/status";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiFetchError } from "@/lib/api-client/client";
import { SPAN_STATUS_DOT, copyText, formatSpanForClaude, useSpanDetail, type ResearchRun } from "@/features/research";
import { PayloadViewer } from "./PayloadViewer";

/** Right pane of the debugger: one step's full input, output, logs and raw document. */
export function SpanDetail({ spanId, run, companyName }: { spanId: string | null; run: ResearchRun | undefined; companyName: string | null }) {
  const q = useSpanDetail(spanId);
  if (!spanId) {
    return (
      <ConsoleCard title="Step">
        <CardEmpty title="Pick a step" hint="Select a step in the trace, or a console line, to see its full input, output and logs." />
      </ConsoleCard>
    );
  }
  if (q.isLoading) {
    return (
      <ConsoleCard title="Step">
        <p className="m-0 text-[13px] text-muted-foreground">Loading step…</p>
      </ConsoleCard>
    );
  }
  if (q.isError || !q.data) {
    return (
      <ConsoleCard title="Step">
        <p role="alert" className="m-0 text-[13px] text-destructive">
          Could not load this step: {q.error instanceof ApiFetchError ? q.error.message : "unknown error"}
        </p>
      </ConsoleCard>
    );
  }

  const { span, logs } = q.data;
  const isLlm = span.kind === "llm";
  const input = (span.input ?? null) as Record<string, unknown> | null;
  const output = (span.output ?? null) as Record<string, unknown> | null;
  const scalarAttrs = Object.entries(span.attrs ?? {}).filter(([, v]) => v !== null && v !== undefined && typeof v !== "object");
  const firstTab = span.error ? "error" : isLlm ? "prompt" : "output";

  return (
    <ConsoleCard title={`${span.kind} · ${span.name}`} meta={<StatusDot state={SPAN_STATUS_DOT[span.status]} label={span.status} />}>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11.5px] text-muted-foreground">
          <span>{span.duration_ms != null ? formatDuration(span.duration_ms) : "running…"}</span>
          {scalarAttrs.map(([k, v]) => (
            <span key={k}>
              {k} <span className="text-foreground">{String(v)}</span>
            </span>
          ))}
          {span.error?.code_ref ? (
            <button
              type="button"
              className="underline-offset-4 hover:underline"
              onClick={() => copyText(`apps/ai-service/${span.error!.code_ref}`, "Code location copied")}
            >
              code {span.error.code_ref}
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" onClick={() => copyText(formatSpanForClaude({ span, logs, run: run ?? null, companyName }), "Copied for Claude")}>
            Copy for Claude
          </Button>
          <Button size="sm" variant="strong" onClick={() => copyText(JSON.stringify(q.data, null, 2), "Step JSON copied")}>
            Copy JSON
          </Button>
        </div>
        <Tabs key={span.span_id} defaultValue={firstTab}>
          <TabsList className="flex-wrap">
            {span.error ? <TabsTrigger value="error">Error</TabsTrigger> : null}
            {isLlm ? <TabsTrigger value="prompt">Prompt</TabsTrigger> : null}
            {isLlm ? <TabsTrigger value="reply">Reply</TabsTrigger> : null}
            <TabsTrigger value="input">Input</TabsTrigger>
            <TabsTrigger value="output">Output</TabsTrigger>
            <TabsTrigger value="logs">Logs ({logs.length})</TabsTrigger>
            <TabsTrigger value="raw">Raw</TabsTrigger>
          </TabsList>
          {span.error ? (
            <TabsContent value="error">
              <PayloadViewer language="plaintext" value={`${span.error.type}: ${span.error.message}\n\n${span.error.traceback ?? ""}`} />
            </TabsContent>
          ) : null}
          {isLlm ? (
            <TabsContent value="prompt">
              <PayloadViewer language="plaintext" value={`${String(input?.system ?? "")}\n\n────── user ──────\n\n${String(input?.user ?? "")}`} />
            </TabsContent>
          ) : null}
          {isLlm ? (
            <TabsContent value="reply">
              <PayloadViewer
                language="plaintext"
                value={typeof output?.content === "string" ? output.content : JSON.stringify(output?.data ?? null, null, 2)}
              />
            </TabsContent>
          ) : null}
          <TabsContent value="input"><PayloadViewer value={span.input ?? null} /></TabsContent>
          <TabsContent value="output"><PayloadViewer value={span.output ?? null} /></TabsContent>
          <TabsContent value="logs"><LogTerminal logs={logs} title="Step logs" className="h-[420px]" /></TabsContent>
          <TabsContent value="raw"><PayloadViewer value={q.data} /></TabsContent>
        </Tabs>
      </div>
    </ConsoleCard>
  );
}
