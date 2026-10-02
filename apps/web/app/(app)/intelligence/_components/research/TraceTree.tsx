"use client";

import * as React from "react";
import { ChevronRight, ClipboardCopy } from "lucide-react";
import { StatusDot, padCount } from "@/components/hud";
import { CardEmpty, ConsoleCard, HeaderCount } from "@/components/observability/ConsoleCard";
import { formatDuration } from "@/components/observability/status";
import { cn } from "@/lib/utils/cn";
import { SPAN_STATUS_DOT, countSpans, flattenVisible, type ResearchItem, type ResearchSpan, type SpanNode } from "@/features/research";
import { GraphMiniMap } from "./GraphMiniMap";

const KIND_LABEL: Record<string, string> = {
  run: "RUN", company: "CO", node: "NODE", exa: "EXA", llm: "LLM", cache: "CACHE", merge: "MERGE", normalize: "NORM", db: "DB",
};

/** Left pane of the debugger: run → company → node → step, live status, durations, errors bubbling up. */
export function TraceTree({
  roots,
  items,
  selectedSpanId,
  onSelectSpan,
  onCopyFailure,
}: {
  roots: SpanNode[];
  items: ResearchItem[];
  selectedSpanId: string | null;
  onSelectSpan: (span: ResearchSpan) => void;
  onCopyFailure: (item: ResearchItem) => void;
}) {
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(new Set());
  const rows = React.useMemo(() => flattenVisible(roots, collapsed), [roots, collapsed]);
  const itemsByCompany = React.useMemo(() => new Map(items.map((i) => [i.company_id, i])), [items]);
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <ConsoleCard title="Trace" meta={<HeaderCount>{padCount(countSpans(roots))} steps</HeaderCount>}>
      {rows.length === 0 ? (
        <CardEmpty title="No steps yet" hint="Steps appear here as the run works." />
      ) : (
        <ul aria-label="Run trace" className="m-0 max-h-[560px] list-none overflow-y-auto p-0">
          {rows.map((node) => {
            const s = node.span;
            const expandable = node.children.length > 0;
            const open = !collapsed.has(s.span_id);
            const item = s.kind === "company" && s.company_id ? itemsByCompany.get(s.company_id) : undefined;
            const retries = typeof s.attrs?.retries === "number" ? (s.attrs.retries as number) : 0;
            return (
              <li key={s.span_id}>
                <div
                  className={cn("flex items-center gap-1 rounded-md pr-2 text-[13px]", s.span_id === selectedSpanId ? "bg-line-2" : "hover:bg-accent")}
                  style={{ paddingLeft: 4 + node.depth * 14 }}
                >
                  {expandable ? (
                    <button
                      type="button"
                      aria-label={`${open ? "Collapse" : "Expand"} ${s.name}`}
                      aria-expanded={open}
                      className="grid h-5 w-5 flex-none place-items-center text-faint"
                      onClick={() => toggle(s.span_id)}
                    >
                      <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")} />
                    </button>
                  ) : (
                    <span aria-hidden className="h-5 w-5 flex-none" />
                  )}
                  <button type="button" aria-current={s.span_id === selectedSpanId ? "true" : undefined} className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left" onClick={() => onSelectSpan(s)}>
                    <StatusDot state={SPAN_STATUS_DOT[s.status]} srLabel={s.status} />
                    <span className="w-11 flex-none font-mono text-[10px] uppercase tracking-[0.08em] text-faint">{KIND_LABEL[s.kind] ?? s.kind}</span>
                    <span className="min-w-0 flex-1 truncate">{s.name}</span>
                    {node.hasError && s.status !== "error" ? (
                      <span role="img" aria-label="a step inside failed" className="h-1.5 w-1.5 flex-none rounded-full bg-destructive" />
                    ) : null}
                    {retries > 0 ? <span className="font-mono text-[10.5px] text-faint">↻{retries}</span> : null}
                    <span className="flex-none font-mono text-[11px] tabular-nums text-faint">{s.duration_ms != null ? formatDuration(s.duration_ms) : "…"}</span>
                  </button>
                  {item?.status === "failed" ? (
                    <button
                      type="button"
                      aria-label={`Copy failure report for ${s.name}`}
                      title="Copy failure report"
                      className="grid h-6 w-6 flex-none place-items-center text-destructive"
                      onClick={() => onCopyFailure(item)}
                    >
                      <ClipboardCopy className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
                {item && open ? (
                  <div className="pb-1 pr-2" style={{ paddingLeft: 26 + node.depth * 14 }}>
                    <GraphMiniMap item={item} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </ConsoleCard>
  );
}
