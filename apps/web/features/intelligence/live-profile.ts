import { apiStream } from "@/lib/api-client/client";
import type { components } from "@/lib/api-client/generated/schema";

export type LiveProfileTrace = components["schemas"]["ProfileLiveTraceResponse"];
export type LiveProfileEvent = components["schemas"]["ProfileLiveTraceEvent"];
export type LiveProfileStage = components["schemas"]["ProfileTraceStage"];
export type LiveProfileSource = components["schemas"]["ProfileTraceSource"];
export type LiveProfileProvider = components["schemas"]["ProfileTraceProviderCheck"];
export type LiveProfileComponent = components["schemas"]["ProfileTraceComponent"];
export type LiveProfileEvidence = components["schemas"]["ProfileScoreEvidence"];
export type LiveProfileLlmCall = components["schemas"]["ProfileTraceLlmCall"];

export const LIVE_PROFILE_ENDPOINT = "/api/v1/intelligence/profile-scoring/live";

/**
 * Run the admin live trace and hand each NDJSON event to `onEvent` as it arrives. Resolves when the
 * stream ends; HTTP errors (bad request, unknown user, auth) reject before any event.
 */
export async function streamLiveProfileCalculation(
  userId: string,
  opts: { forceReassess?: boolean; signal?: AbortSignal; onEvent: (event: LiveProfileEvent) => void },
): Promise<void> {
  const res = await apiStream(LIVE_PROFILE_ENDPOINT, {
    method: "POST",
    json: { userId, ...(opts.forceReassess ? { forceReassess: true } : {}) },
    headers: { Accept: "application/x-ndjson" },
    // A 401 is answered before the run starts, so the single silent-refresh retry is safe here.
    signal: opts.signal,
  });
  if (!res.body) throw new Error("The live trace response has no body to stream.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const flush = (line: string) => {
    const text = line.trim();
    if (!text) return;
    try {
      opts.onEvent(JSON.parse(text) as LiveProfileEvent);
    } catch {
      opts.onEvent({ seq: -1, ts: new Date().toISOString(), elapsedMs: 0, kind: "error", stage: "client", level: "error", message: `Unreadable stream line: ${text.slice(0, 200)}` });
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      flush(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  flush(buffer + decoder.decode());
}

export type LiveRunStatus = "idle" | "running" | "completed" | "failed" | "stopped" | "incomplete";

export interface LiveTraceReportInput {
  userId: string;
  status: LiveRunStatus;
  forceReassess: boolean;
  events: LiveProfileEvent[];
  trace: LiveProfileTrace | null;
  /** A failure on the client side (network, HTTP status, aborted stream). */
  clientError: string | null;
}

const cell = (value: unknown) => String(value ?? "—").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim() || "—";

/**
 * One self-contained Markdown report of a run, written to be pasted into Claude Code: what ran, what
 * failed (with stacks), every LLM call, the score breakdown, and the full event log. Works for a run
 * that failed or stopped midway, since it is built from whatever events arrived.
 */
export function buildLiveTraceReport(input: LiveTraceReportInput): string {
  const { events, trace } = input;
  const first = events[0], last = events.at(-1);
  const errors = events.filter((event) => event.kind === "error");
  const stages = new Map<string, { status: string; durationMs?: number; message: string }>();
  for (const event of events.filter((e) => e.kind === "stage")) {
    const data = (event.data ?? {}) as { id?: string; status?: string; durationMs?: number };
    stages.set(data.id ?? event.stage, { status: data.status ?? "?", durationMs: data.durationMs, message: event.message });
  }
  const lines: string[] = [
    "# InterviewIQ profile-scoring live trace",
    "",
    "> Paste this into Claude Code from the interviewiq repo root to analyze the run or debug an error.",
    "> Code: `apps/api/src/services/profileScoring.ts` (`inspectLive`, `refreshSemanticAssessments`), `apps/api/src/domain/profileScoring/engineV5.ts` (engine),",
    "> `apps/api/src/domain/profileScoring/config.ts` (weights), `apps/ai-service/app/profile_scoring/` (LLM prompts). Full detail is kept (personal data included); only credentials are scrubbed.",
    "",
    "## Run",
    `- Status: **${input.status}**${input.clientError ? ` (client: ${input.clientError})` : ""}`,
    `- User: ${input.userId}${trace ? ` · trace ${trace.traceId}` : ""}`,
    `- Started: ${first?.ts ?? "—"} · last event at +${last?.elapsedMs ?? 0} ms · ${events.length} event(s)`,
    `- Options: forceReassess=${input.forceReassess}`,
  ];
  if (trace) {
    lines.push(
      `- Algorithm: ${trace.algorithm.version} · config ${trace.algorithm.configHash} · input ${trace.algorithm.inputHash}`,
      `- Score: ${trace.score ?? "none"} · coverage ${trace.coverage}% · level ${trace.snapshot.level} · ${trace.eligibility.eligible ? "leaderboard-eligible" : `not eligible (${trace.eligibility.reasons.join("; ") || "no reason"})`}`,
    );
  }
  if (errors.length || input.clientError) {
    lines.push("", "## Errors");
    if (input.clientError) lines.push(`- Client: ${input.clientError}`);
    for (const event of errors) {
      const data = (event.data ?? {}) as { stack?: string | null; status?: number; code?: string };
      lines.push("", `### ${event.stage}: ${event.message}${data.code ? ` (${data.code}${data.status ? `, HTTP ${data.status}` : ""})` : ""}`, "```", data.stack ?? "(no stack)", "```");
    }
  }
  lines.push("", "## Stages", "| Stage | Status | ms | Detail |", "| --- | --- | --- | --- |");
  for (const [id, stage] of stages) lines.push(`| ${cell(id)} | ${cell(stage.status)} | ${cell(stage.durationMs)} | ${cell(stage.message)} |`);
  const llm = events.filter((event) => event.kind === "llm");
  lines.push("", `## LLM calls (${llm.length} event(s))`);
  if (!llm.length) lines.push("None.");
  for (const event of llm) {
    lines.push(`- +${event.elapsedMs} ms ${event.level.toUpperCase()} ${event.message}`);
    if (event.data !== undefined) lines.push("  ```json", ...JSON.stringify(event.data, null, 2).split("\n").map((line) => `  ${line}`), "  ```");
  }
  if (trace) {
    lines.push("", "## Components", `Formula: ${trace.formula.expression}`, "", "| Component | Role | Status | Weight | Score | Contribution | Sub-features (value @ weight, share) |", "| --- | --- | --- | --- | --- | --- | --- |");
    for (const component of trace.components) {
      const parts = component.subFeatures.map((row) => `${row.key}=${row.value} @${row.weight} (${row.share}%)${row.status === "missing" ? " [missing, counted as 0]" : ""}`).join("; ");
      lines.push(`| ${cell(component.id)} | ${cell(component.role)} | ${cell(component.status)} | ${component.weight} | ${cell(component.score)} | ${cell(component.contribution)} | ${cell(parts || (component.score === null ? "no evidence" : ""))} |`);
    }
    lines.push("", "## Warnings", ...(trace.warnings.length ? trace.warnings.map((warning) => `- ${warning}`) : ["None."]));
    lines.push("", `## Evidence (${trace.evidence.length})`, "| Feature | Source | Type | Value | Contribution | Path |", "| --- | --- | --- | --- | --- | --- |");
    for (const item of trace.evidence) lines.push(`| ${cell(item.feature)} | ${cell(item.source)} | ${cell(item.evidenceType)} | ${cell(item.value)} | ${cell(item.scoreContribution)} | ${cell(item.path)} |`);
    lines.push("", "## Sources", ...trace.sources.map((source) => `- ${source.source}: ${source.status}${source.fetchedAt ? ` · fetched ${source.fetchedAt}` : ""}${source.ageDays == null ? "" : ` · ${source.ageDays} days old`}`));
  }
  lines.push("", "## Event log (NDJSON; the result event's data is the final trace below)", "```ndjson",
    ...events.map((event) => JSON.stringify(event.kind === "result" ? { ...event, data: "[see Final trace JSON]" } : event)), "```");
  if (trace) lines.push("", "## Final trace JSON", "```json", JSON.stringify(trace, null, 2), "```");
  return lines.join("\n");
}
