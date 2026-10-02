import { COPY_BUNDLE_MAX_CHARS } from "@/lib/constants/research";
import type { ResearchEvent, ResearchItem, ResearchRun, ResearchSpanDetail } from "./types";

/**
 * "Copy for Claude" bundles (spec §9.1): markdown a developer pastes into Claude Code. Context
 * first (what ran, where the code is), then fenced input / output / error / logs, each trimmed
 * so the whole bundle stays under COPY_BUNDLE_MAX_CHARS.
 */

const BUDGET = { input: 12_000, output: 12_000, error: 8_000, logs: 6_000, previous: 6_000 } as const;

export function trimMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const keep = Math.max(0, max - 40);
  const head = Math.ceil(keep * 0.6);
  const tail = keep - head;
  return `${text.slice(0, head)}\n… [${text.length - head - tail} chars trimmed] …\n${text.slice(text.length - tail)}`;
}

export function fence(lang: string, body: string): string {
  const longestRun = Math.max(0, ...[...body.matchAll(/`+/g)].map((m) => m[0].length));
  const ticks = "`".repeat(Math.max(3, longestRun + 1));
  return `${ticks}${lang}\n${body}\n${ticks}`;
}

const json = (value: unknown) => JSON.stringify(value ?? null, null, 2);

export function logLine(e: ResearchEvent): string {
  return `${String(e.seq).padStart(6)} ${e.ts.slice(11, 19)} ${e.level.padEnd(5)} ${(e.node ?? "-").padEnd(12)} ${e.type.padEnd(16)} ${e.message}`;
}

export interface SpanBundleInput {
  span: ResearchSpanDetail;
  logs: ResearchEvent[];
  run: Pick<ResearchRun, "run_id" | "mode" | "pipeline_version"> | null;
  companyName?: string | null;
}

export function formatSpanForClaude({ span, logs, run, companyName }: SpanBundleInput): string {
  const attrs = (span.attrs ?? {}) as Record<string, unknown>;
  const header = [
    `## InterviewIQ research trace — ${span.kind} · ${span.name} · ${span.status}`,
    "",
    `- run: ${run?.run_id ?? span.run_id} (mode ${run?.mode ?? "?"}, pipeline ${run?.pipeline_version ?? "?"})`,
    `- company: ${companyName ?? span.company_id ?? "—"}`,
    `- node: ${span.node ?? "—"}`,
    `- span: ${span.span_id}${span.parent_id ? ` (parent ${span.parent_id})` : ""}`,
    `- duration: ${span.duration_ms ?? "?"} ms`,
    ...(attrs.model ? [`- model: ${String(attrs.model)}`] : []),
    ...(attrs.prompt_name ? [`- prompt: ${String(attrs.prompt_name)}@${String(attrs.prompt_version ?? "?")}`] : []),
    ...(span.error?.code_ref ? [`- code: apps/ai-service/${span.error.code_ref}`] : []),
  ];
  const parts = [header.join("\n")];
  if (span.error) {
    parts.push("### Error", fence("text", trimMiddle(`${span.error.type}: ${span.error.message}\n\n${span.error.traceback ?? ""}`, BUDGET.error)));
  }
  parts.push("### Input", fence("json", trimMiddle(json(span.input), BUDGET.input)));
  parts.push("### Output", fence("json", trimMiddle(json(span.output), BUDGET.output)));
  parts.push("### Attributes", fence("json", json(attrs)));
  if (logs.length > 0) parts.push("### Logs", fence("text", trimMiddle(logs.map(logLine).join("\n"), BUDGET.logs)));
  return trimMiddle(parts.join("\n\n"), COPY_BUNDLE_MAX_CHARS);
}

export interface FailureReportInput {
  run: ResearchRun;
  item: ResearchItem;
  failing: ResearchSpanDetail | null;
  previousOutputs: Array<{ node: string; output: unknown }>;
  logs: ResearchEvent[];
}

export function formatFailureReport({ run, item, failing, previousOutputs, logs }: FailureReportInput): string {
  const timeline = Object.entries(item.nodes ?? {}).map(([node, p]) => `- ${node}: ${p.status ?? "?"}${p.error ? ` — ${p.error}` : ""}`);
  const parts = [
    `## InterviewIQ research failure — ${item.company_name} (${item.company_slug})`,
    "",
    `- run: ${run.run_id} (mode ${run.mode}, pipeline ${run.pipeline_version ?? "?"}, trigger ${run.trigger})`,
    `- item: ${item.status} · attempts ${item.attempts} · last completed node: ${item.last_node ?? "none"}`,
    ...(item.error?.code_ref ? [`- code: apps/ai-service/${item.error.code_ref}`] : []),
    "",
    "### Node timeline",
    timeline.length > 0 ? timeline.join("\n") : "- (no node started)",
  ];
  if (item.error) {
    parts.push("", "### Error", fence("text", trimMiddle(`${item.error.type}: ${item.error.message}\n\n${item.error.traceback ?? ""}`, BUDGET.error)));
  }
  for (const prev of previousOutputs) parts.push("", `### Output of ${prev.node}`, fence("json", trimMiddle(json(prev.output), BUDGET.previous)));
  if (failing) {
    parts.push(
      "", `### Failing step: ${failing.kind} · ${failing.name}`,
      "Input:", fence("json", trimMiddle(json(failing.input), BUDGET.input)),
      "Output:", fence("json", trimMiddle(json(failing.output), 4_000)),
    );
  }
  if (logs.length > 0) parts.push("", "### Logs", fence("text", trimMiddle(logs.map(logLine).join("\n"), BUDGET.logs)));
  return trimMiddle(parts.join("\n"), COPY_BUNDLE_MAX_CHARS);
}

export function formatRunSummary(run: ResearchRun, items: ResearchItem[]): string {
  const c = run.counters;
  const b = run.budget;
  return [
    `## Research run ${run.run_id} — ${run.status}${run.pause_reason ? ` (${run.pause_reason})` : ""}`,
    "",
    `- mode ${run.mode} · trigger ${run.trigger} · scope ${run.scope} · pipeline ${run.pipeline_version ?? "?"}`,
    `- started ${run.started_at ?? "—"} · finished ${run.finished_at ?? "—"}`,
    `- budget: exa ${b.exa_used}/${b.exa_cap} · llm ${b.llm_used}/${b.llm_cap} · tokens ${b.tokens_in} in / ${b.tokens_out} out`,
    `- ${c.total} total · ${c.done} done · ${c.skipped} skipped · ${c.failed} failed · ${c.cancelled} cancelled · ${c.paused} paused · ${c.running} running · ${c.queued} queued`,
    ...(run.error ? [`- error: ${run.error}`] : []),
    "",
    ...items.map((i) => `- ${i.company_name}: ${i.status}${i.error ? ` — ${i.error.type}: ${i.error.message}` : ""}`),
  ].join("\n");
}
