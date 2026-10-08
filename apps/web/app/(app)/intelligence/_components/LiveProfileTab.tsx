"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MonoPill } from "@/components/patterns";
import { CardEmpty, ConsoleCard, HeaderCount } from "@/components/observability/ConsoleCard";
import { HairlineHead, HairlineTable, Td, Th, Tr } from "@/components/observability/HairlineTable";
import { LogTerminal } from "@/components/observability/LogTerminal";
import { ApiFetchError } from "@/lib/api-client/client";
import {
  buildLiveTraceReport,
  streamLiveProfileCalculation,
  useUsers,
  type AdminUser,
  type LiveProfileEvent,
  type LiveProfileTrace,
  type LiveRunStatus,
} from "@/features/intelligence";

/** The stages the API streams, in order. */
const STAGES = [
  ["user", "User"],
  ["sources", "Sources"],
  ["semantic", "AI item assessment"],
  ["snapshot", "Snapshot"],
  ["engine", "Engine"],
  ["trace", "Trace"],
] as const;

function displayError(error: unknown, fallback: string): string {
  if (error instanceof ApiFetchError) return `${fallback} (${error.status}): ${error.message}`;
  return error instanceof Error && error.message ? `${fallback}: ${error.message}` : fallback;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function toneFor(status: string): "brand" | "ink" | "soft" | "ghost" | "alert" {
  if (["completed", "available", "used", "eligible", "reused"].includes(status)) return "brand";
  if (["failed", "missing", "ineligible", "excluded", "incomplete"].includes(status)) return "alert";
  if (["running"].includes(status)) return "ink";
  if (["skipped", "not_used", "pending", "stopped"].includes(status)) return "ghost";
  return "soft";
}

function StatusPill({ status }: { status: string }) {
  return <MonoPill tone={toneFor(status)}>{status.replaceAll("_", " ")}</MonoPill>;
}

function UserSearch({ users, isLoading, error, selected, onSelect, onClear, disabled }: {
  users: AdminUser[] | undefined;
  isLoading: boolean;
  error: unknown;
  selected: AdminUser | null;
  onSelect: (user: AdminUser) => void;
  onClear: () => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return users ?? [];
    return (users ?? []).filter((user) => [user.name, user.email, user.id].some((value) => value.toLowerCase().includes(needle)));
  }, [query, users]);

  const choose = (user: AdminUser) => {
    onSelect(user);
    setQuery(`${user.name || "Unnamed user"} · ${user.email}`);
    setOpen(false);
  };

  return <div className="space-y-3">
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-[min(100%,460px)] flex-1">
        <label htmlFor="live-profile-user-search" className="mb-1.5 block text-sm font-medium">Select user</label>
        <div className="relative">
          <Input
            id="live-profile-user-search"
            role="combobox"
            value={query}
            placeholder={isLoading ? "Loading users…" : "Search by name, email, or user ID"}
            disabled={isLoading || !!error || disabled}
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls="live-profile-user-listbox"
            aria-activedescendant={open && filtered[activeIndex] ? `live-profile-user-${filtered[activeIndex].id}` : undefined}
            onFocus={() => setOpen(true)}
            onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); setOpen(true); }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActiveIndex((index) => Math.min(index + 1, Math.max(0, filtered.length - 1))); }
              if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(0, index - 1)); }
              if (event.key === "Enter" && open && filtered[activeIndex]) { event.preventDefault(); choose(filtered[activeIndex]); }
              if (event.key === "Escape") setOpen(false);
            }}
          />
          {open ? <div id="live-profile-user-listbox" role="listbox" aria-label="Available users" className="absolute inset-x-0 top-11 z-30 max-h-64 overflow-y-auto rounded-xl border border-line-2 bg-card p-1 shadow-lg">
            {filtered.length === 0 ? <p className="px-3 py-2 text-sm text-muted-foreground">No matching users.</p> : filtered.map((user, index) => <button
              type="button"
              role="option"
              id={`live-profile-user-${user.id}`}
              aria-selected={selected?.id === user.id}
              key={user.id}
              className={`block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent ${index === activeIndex ? "bg-accent" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(user)}
            >
              <span className="block">{user.name || "Unnamed user"}</span>
              <span className="block font-mono text-xs text-muted-foreground">{user.email} · {user.id}</span>
            </button>)}
          </div> : null}
        </div>
      </div>
      {selected ? <Button type="button" variant="outline" size="sm" onClick={onClear} disabled={disabled}>Clear selected user</Button> : null}
    </div>
    {error ? <p role="alert" className="m-0 text-sm text-destructive">{displayError(error, "Could not load users")}</p> : null}
    {selected ? <p className="m-0 text-xs text-muted-foreground">Selected: <span className="font-medium text-foreground">{selected.name || "Unnamed user"}</span> · <span className="font-mono">{selected.id}</span></p> : null}
  </div>;
}

/** Latest status per stage from the streamed stage events. */
function stageStates(events: LiveProfileEvent[], running: boolean) {
  const latest = new Map<string, { status: string; durationMs?: number; message: string }>();
  for (const event of events) {
    if (event.kind !== "stage") continue;
    const data = (event.data ?? {}) as { id?: string; status?: string; durationMs?: number };
    latest.set(data.id ?? event.stage, { status: data.status ?? "running", durationMs: data.durationMs, message: event.message });
  }
  if (events.some((event) => event.kind === "result")) latest.set("trace", { status: "completed", message: "Trace assembled." });
  return STAGES.map(([id, label]) => ({ id, label, ...(latest.get(id) ?? { status: running ? "pending" : "not run", message: running ? "Waiting…" : "Not reached." }) }));
}

function StageTimeline({ events, running }: { events: LiveProfileEvent[]; running: boolean }) {
  const stages = stageStates(events, running);
  return <ConsoleCard title="Stage timeline" meta={<HeaderCount>{running ? "LIVE" : `${stages.length} stages`}</HeaderCount>}>
    <ol aria-label="Live profile calculation stages" className="grid gap-2 p-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-3 xl:grid-cols-6">
      {stages.map((stage) => <li key={stage.id} className="rounded-lg border border-line-2 bg-panel p-3" aria-current={stage.status === "running" ? "step" : undefined}>
        <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{stage.label}</span><StatusPill status={stage.status} /></div>
        <p className="m-0 mt-2 break-words text-xs text-muted-foreground">{stage.message}</p>
        {stage.durationMs !== undefined ? <p className="m-0 mt-1 font-mono text-[11px] text-faint">{stage.durationMs} ms</p> : null}
      </li>)}
    </ol>
  </ConsoleCard>;
}

const TERMINAL_LEVEL: Record<string, string> = { error: "ERROR", warn: "WARNING", info: "INFO", debug: "DEBUG" };

function ErrorCard({ events, clientError }: { events: LiveProfileEvent[]; clientError: string | null }) {
  const errors = events.filter((event) => event.kind === "error");
  if (!errors.length && !clientError) return null;
  return <ConsoleCard title="Errors" meta={<StatusPill status="failed" />}>
    <div className="space-y-3 p-4 sm:px-5">
      {clientError ? <p role="alert" className="m-0 text-sm text-destructive">{clientError}</p> : null}
      {errors.map((event) => {
        const data = (event.data ?? {}) as { stack?: string | null };
        return <div key={event.seq} className="space-y-2">
          <p role="alert" className="m-0 text-sm text-destructive"><span className="font-mono text-xs">[{event.stage}]</span> {event.message}</p>
          {data.stack ? <pre className="m-0 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line-2 bg-panel p-3 font-mono text-[11px] text-muted-foreground">{data.stack}</pre> : null}
        </div>;
      })}
    </div>
  </ConsoleCard>;
}

/** Every AI-service call as it happens, with the exact (redacted) request and response. */
function LlmCalls({ events }: { events: LiveProfileEvent[] }) {
  const calls = events.filter((event) => event.kind === "llm");
  return <ConsoleCard title="LLM calls" meta={<HeaderCount>{calls.length} events</HeaderCount>}>
    {calls.length === 0 ? <p className="m-0 p-4 text-sm text-muted-foreground sm:px-5">No AI-service activity yet. Unchanged items reuse their stored assessment; tick “Force re-assess” to send every item.</p> :
      <ul className="m-0 list-none space-y-2 p-4 sm:px-5">{calls.map((event) => <li key={event.seq} className="rounded-lg border border-line-2 p-3">
        <div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-mono text-[11px] text-faint">+{event.elapsedMs} ms</span><StatusPill status={event.level === "error" ? "failed" : "completed"} /><span className="min-w-0 break-words">{event.message}</span></div>
        {event.data !== undefined ? <details className="mt-2"><summary className="cursor-pointer text-xs text-muted-foreground">Request / response detail</summary>
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">{JSON.stringify(event.data, null, 2)}</pre></details> : null}
      </li>)}</ul>}
  </ConsoleCard>;
}

function RunSummary({ trace }: { trace: LiveProfileTrace }) {
  const values = [
    ["Trace ID", trace.traceId], ["Algorithm", trace.algorithm.version], ["Score", formatValue(trace.score)], ["Coverage", `${trace.coverage}%`], ["Level", formatValue(trace.snapshot.level)],
    ["Leaderboard", trace.eligibility.eligible ? "Eligible" : `Not eligible: ${trace.eligibility.reasons.join("; ")}`], ["Duration", `${Math.max(0, new Date(trace.finishedAt).getTime() - new Date(trace.startedAt).getTime())} ms`],
    ["Config hash", trace.algorithm.configHash], ["Input hash", trace.algorithm.inputHash], ["Snapshot", trace.snapshot.id],
  ];
  return <ConsoleCard title="Run summary" meta={<StatusPill status={trace.score === null ? "insufficient evidence" : "completed"} />}>
    <dl className="grid gap-x-6 gap-y-4 p-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-5">{values.map(([label, value]) => <div key={label} className="min-w-0"><dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-faint">{label}</dt><dd className="m-0 mt-1 break-words text-sm">{value}</dd></div>)}</dl>
  </ConsoleCard>;
}

function SourceCards({ trace }: { trace: LiveProfileTrace }) {
  const evidenceBySource = useMemo(() => trace.evidence.reduce<Record<string, number>>((counts, evidence) => { counts[evidence.source.toUpperCase()] = (counts[evidence.source.toUpperCase()] ?? 0) + 1; return counts; }, {}), [trace.evidence]);
  return <ConsoleCard title="Sources" meta={<HeaderCount>{trace.sources.length} sources</HeaderCount>}>
    <div className="grid gap-3 p-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-3">{trace.sources.map((source) => <article key={source.source} className="rounded-lg border border-line-2 p-4">
      <div className="flex items-center justify-between gap-2"><h3 className="m-0 text-sm font-medium">{source.source}</h3><StatusPill status={source.status} /></div>
      <dl className="mt-3 space-y-2 text-xs"><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Fetched</dt><dd className="m-0 text-right">{source.ageDays == null ? "" : `${source.ageDays} days old · `}{formatDate(source.fetchedAt)}</dd></div><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Evidence</dt><dd className="m-0 text-right">{evidenceBySource[source.source] ?? 0}</dd></div></dl>
      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">{Object.entries(source.extractedFieldCounts).map(([key, count]) => <MonoPill key={key} tone="ghost">{key}: {count}</MonoPill>)}</div>
    </article>)}</div>
  </ConsoleCard>;
}

function ProviderCards({ trace }: { trace: LiveProfileTrace }) {
  return <ConsoleCard title="Providers" meta={<HeaderCount>{trace.llmCalls.length} AI-service events</HeaderCount>}>
    <div className="grid gap-3 p-4 sm:grid-cols-3 sm:px-5">{trace.providerChecks.map((provider) => <article key={provider.provider} className="rounded-lg border border-line-2 p-4"><div className="flex items-center justify-between gap-2"><h3 className="m-0 text-sm font-medium">{provider.provider}</h3><StatusPill status={provider.status} /></div><p className="m-0 mt-2 break-words text-xs text-muted-foreground">{provider.reason}</p><p className="m-0 mt-3 font-mono text-[11px] text-faint">{provider.mode}</p></article>)}</div>
  </ConsoleCard>;
}

/** Each component with the sub-features (or items) that formed it. */
function ComponentTable({ trace }: { trace: LiveProfileTrace }) {
  return <ConsoleCard title="Score breakdown" meta={<HeaderCount>{trace.formula.expression}</HeaderCount>}>
    <HairlineTable label="Score components and sub-features" className="min-w-[940px]"><HairlineHead><Th>Component</Th><Th>Role</Th><Th>Weight</Th><Th>Score</Th><Th>Contribution</Th><Th>Sub-features (value · weight · share)</Th></HairlineHead>
      <tbody>{trace.components.map((component) => <Tr key={component.id}>
        <Td><span className="font-medium">{component.label}</span><span className="block font-mono text-[11px] text-faint">{component.id}</span></Td>
        <Td><span className="block text-xs">{component.role === "core" ? "Core" : component.role === "bonus" ? "Extra" : "—"}</span><StatusPill status={component.status} /></Td>
        <Td>{component.weight}</Td><Td>{formatValue(component.score)}</Td><Td>{formatValue(component.contribution)}</Td>
        <Td className="text-xs">{component.subFeatures.length === 0 ? <span className="text-muted-foreground">{component.score === null ? "No evidence" : "—"}</span> :
          <ul className="m-0 list-none space-y-0.5 p-0">{component.subFeatures.map((row) => <li key={row.key} className="flex flex-wrap gap-x-2"><span className="font-mono">{row.key}</span><span className="text-muted-foreground">{row.value} · {row.weight} · {row.share}%</span>{row.status === "missing" ? <MonoPill tone="alert">missing · 0</MonoPill> : null}</li>)}</ul>}</Td>
      </Tr>)}</tbody></HairlineTable>
    <p className="m-0 border-t border-line px-4 py-3 text-xs text-muted-foreground sm:px-5">Every part is expected at this level in proportion to its weight: missing, failed or unassessed counts as 0. Core parts are the ones nothing else stands in for; the rest are extra credit. Weight with evidence {trace.formula.availableWeight} of 100 · final score <span className="font-medium text-foreground">{formatValue(trace.score)}</span></p>
  </ConsoleCard>;
}

function EvidenceTable({ trace }: { trace: LiveProfileTrace }) {
  return <ConsoleCard title="Evidence and eligibility" meta={<StatusPill status={trace.eligibility.eligible ? "eligible" : "ineligible"} />}>
    <HairlineTable label="Profile scoring evidence" className="min-w-[1080px]"><HairlineHead><Th>Feature</Th><Th>Source</Th><Th>Claim / path</Th><Th>Type</Th><Th>Value</Th><Th>Raw</Th><Th>Contribution</Th></HairlineHead>
      <tbody>{trace.evidence.length === 0 ? <Tr><Td colSpan={7}><span className="text-muted-foreground">No evidence.</span></Td></Tr> : trace.evidence.map((evidence) => <Tr key={evidence.id}>
        <Td className="font-mono text-xs">{evidence.feature ?? "—"}</Td><Td>{evidence.source}</Td>
        <Td><span className="block break-words">{evidence.claim}</span><span className="block break-words font-mono text-[11px] text-faint">{evidence.path}</span></Td>
        <Td className="text-xs">{evidence.evidenceType ?? evidence.verification}</Td><Td className="max-w-[160px] break-words">{formatValue(evidence.value)}</Td>
        <Td className="max-w-[240px] break-words font-mono text-[11px] text-muted-foreground">{formatValue(evidence.rawValue).slice(0, 240)}</Td><Td>{formatValue(evidence.scoreContribution)}</Td>
      </Tr>)}</tbody></HairlineTable>
    <div className="grid gap-4 border-t border-line p-4 sm:grid-cols-2 sm:px-5"><div><h3 className="m-0 text-sm font-medium">Warnings</h3>{trace.warnings.length === 0 ? <p className="m-0 mt-2 text-xs text-muted-foreground">None.</p> : <ul className="mt-2 space-y-1 pl-4 text-xs">{trace.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}</div><div><h3 className="m-0 text-sm font-medium">Eligibility</h3><p className="m-0 mt-2 text-xs">{trace.eligibility.eligible ? "Eligible for the same-level leaderboard." : "Not eligible for the leaderboard."}</p>{trace.eligibility.reasons.length > 0 ? <ul className="mt-1 space-y-1 pl-4 text-xs text-muted-foreground">{trace.eligibility.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}</div></div>
  </ConsoleCard>;
}

export function copyLiveProfileTrace(text: string, writeText: (value: string) => Promise<void> = (value) => navigator.clipboard.writeText(value)) {
  return writeText(text);
}

export function LiveProfileTab() {
  const { data: users, isLoading: usersLoading, error: usersError } = useUsers();
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [forceReassess, setForceReassess] = useState(false);
  const [events, setEvents] = useState<LiveProfileEvent[]>([]);
  const [trace, setTrace] = useState<LiveProfileTrace | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [status, setStatus] = useState<LiveRunStatus>("idle");
  const [copied, setCopied] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const running = status === "running";

  const reset = () => {
    generation.current += 1;
    controller.current?.abort();
    setEvents([]); setTrace(null); setClientError(null); setStatus("idle");
  };
  const run = async () => {
    if (!selected) return;
    reset();
    const runGeneration = generation.current, abort = new AbortController();
    controller.current = abort;
    setStatus("running");
    let sawResult = false, sawError = false;
    try {
      await streamLiveProfileCalculation(selected.id, {
        forceReassess, signal: abort.signal,
        onEvent: (event) => {
          if (runGeneration !== generation.current) return;
          if (event.kind === "result") { sawResult = true; setTrace(event.data as LiveProfileTrace); }
          if (event.kind === "error") sawError = true;
          setEvents((previous) => [...previous, event]);
        },
      });
      if (runGeneration !== generation.current) return;
      setStatus(sawError ? "failed" : sawResult ? "completed" : "incomplete");
      if (!sawResult && !sawError) setClientError("The stream ended without a result. The API may have restarted or a proxy cut the connection.");
    } catch (error) {
      if (runGeneration !== generation.current) return;
      if (abort.signal.aborted) { setStatus("stopped"); setClientError("Stopped from this page. The server finishes the run in the background."); return; }
      setStatus("failed");
      setClientError(displayError(error, "Live calculation failed"));
    }
  };
  const stop = () => controller.current?.abort();

  async function copyReport() {
    try {
      await copyLiveProfileTrace(buildLiveTraceReport({ userId: selected?.id ?? "unknown", status, forceReassess, events, trace, clientError }));
      setCopied(true);
      toast.success("Full trace copied. Paste it into Claude Code.");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Could not copy the trace.");
    }
  }

  const logs = useMemo(() => events.map((event) => ({ seq: event.seq, ts: event.ts, level: TERMINAL_LEVEL[event.level] ?? event.level.toUpperCase(), message: `[${event.stage}] ${event.message}` })), [events]);
  const hasOutput = events.length > 0 || clientError !== null;

  return <div className="space-y-5">
    <ConsoleCard title="Live profile calculation" meta={<HeaderCount>ADMIN ONLY</HeaderCount>}>
      <div className="space-y-4 p-4 sm:px-5">
        <p className="m-0 max-w-3xl text-sm text-muted-foreground">Runs one user’s profile scoring the way the weekly job does and streams every step: stored sources, each AI-service call (request and response), company lookups, the snapshot write and every engine computation. Source collectors are not called. The trace keeps full detail (names, contacts, employers, raw profile and source data); only credentials are scrubbed. Copy it straight into Claude Code.</p>
        <UserSearch users={users} isLoading={usersLoading} error={usersError} selected={selected} disabled={running}
          onSelect={(user) => { reset(); setSelected(user); }} onClear={() => { reset(); setSelected(null); }} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand" checked={forceReassess} disabled={running} onChange={(event) => setForceReassess(event.target.checked)} />
          Force re-assess every resume item (sends each one to the LLM even if unchanged)</label>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled={!selected || running} onClick={() => void run()}>{running ? "Running…" : "Run live calculation"}</Button>
          {running ? <Button type="button" variant="outline" onClick={stop}>Stop</Button> : null}
          <Button type="button" variant="outline" disabled={!hasOutput} onClick={() => void copyReport()}>{copied ? "Copied" : "Copy full trace for Claude Code"}</Button>
          {status !== "idle" ? <StatusPill status={status} /> : selected ? <span className="text-xs text-muted-foreground">Ready for {selected.name || selected.id}</span> : null}
        </div>
      </div>
    </ConsoleCard>
    {status !== "idle" ? <>
      <StageTimeline events={events} running={running} />
      <ErrorCard events={events} clientError={clientError} />
      <LogTerminal logs={logs} title="Live log" className="h-96" emptyText="Waiting for the first event…" />
      <LlmCalls events={events} />
    </> : null}
    {trace ? <div className="space-y-5"><RunSummary trace={trace} /><ComponentTable trace={trace} /><SourceCards trace={trace} /><ProviderCards trace={trace} /><EvidenceTable trace={trace} /></div>
      : status === "idle" ? selected ? <CardEmpty title="Ready to calculate." hint="The live trace streams here after you run the selected user." /> : !usersLoading && !usersError ? <CardEmpty title="Select a user to begin." hint="The live trace streams here after an explicit run." /> : null : null}
  </div>;
}
