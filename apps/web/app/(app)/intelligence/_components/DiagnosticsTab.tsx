"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConsoleCard } from "@/components/observability/ConsoleCard";
import { HairlineHead, HairlineTable, Td, Th, Tr } from "@/components/observability/HairlineTable";
import { BETA_NOTE, LEVEL_OPTIONS, levelLabel, percent, scoreValue, useProfileDiagnostics } from "@/features/profile-scoring";
import { ScoreBreakdown, ScoreHistory } from "@/features/profile-scoring/components/ScoreBreakdown";

const STATUS_CLASS = {
  pass: "text-foreground",
  fail: "text-destructive",
  warning: "text-muted-foreground",
  untested: "text-faint",
} as const;

export function DiagnosticsTab() {
  const [input, setInput] = useState("");
  const [userId, setUserId] = useState<string>();
  const query = useProfileDiagnostics(userId);
  const data = query.data;
  const score = data?.score?.current;

  return <div className="space-y-5">
    <ConsoleCard title="Profile scoring diagnostics" bodyClassName="space-y-4 p-4 sm:p-5">
      <p className="m-0 text-sm text-muted-foreground">{BETA_NOTE} These bounded checks report pass, fail, warning or untested; provider verification is not implied.</p>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => {
        event.preventDefault(); setUserId(input.trim() || undefined);
      }}>
        <div className="min-w-0 flex-1"><label htmlFor="diagnostics-user-id" className="mb-2 block text-xs text-muted-foreground">User ID (optional)</label>
          <input id="diagnostics-user-id" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Leave empty for system checks"
            className="h-10 w-full rounded-lg border border-line-3 bg-card px-3 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring" /></div>
        <Button variant="outline" type="submit">Inspect</Button>
        <Button variant="ghost" type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh diagnostics</Button>
      </form>
      <p className="m-0 break-words text-xs text-muted-foreground">{userId ? `Inspecting user ${userId}.` : "System overview. Enter a user ID for snapshot replay evidence."} No provider credentials or raw private source payloads are displayed.</p>
      {query.isLoading ? <p role="status" className="text-sm">Loading diagnostics…</p> : query.isError || !data ? <div>
        <p role="alert" className="text-sm text-destructive">Could not load diagnostics.</p>
        <Button size="sm" variant="outline" onClick={() => void query.refetch()}>Retry</Button>
      </div> : <>
        <p className="m-0 text-xs text-muted-foreground">Checked {data.checkedAt}</p>
        <div className="flex flex-wrap gap-3 text-xs">{(["pass", "fail", "warning", "untested"] as const).map((status) =>
          <span key={status} className={STATUS_CLASS[status]}>{status}: {data.checks.filter((check) => check.status === status).length}</span>)}</div>
      </>}
    </ConsoleCard>

    {data ? <>
      <ConsoleCard title="Bounded diagnostic checks">
        {data.checks.length === 0 ? <p className="p-5 text-sm text-muted-foreground">No checks returned. Validation is untested.</p> :
          <HairlineTable label="Diagnostic check results" className="min-w-[560px]">
            <HairlineHead><Th>Check</Th><Th>Status</Th><Th>Detail</Th></HairlineHead>
            <tbody>{data.checks.map((check) => <Tr key={check.id}><Td>{check.label}</Td>
              <Td><span className={`font-mono text-xs ${STATUS_CLASS[check.status]}`}>{check.status}</span></Td>
              <Td className="max-w-xl break-words text-xs text-muted-foreground">{check.detail}</Td></Tr>)}</tbody>
          </HairlineTable>}
      </ConsoleCard>
      <ConsoleCard title="Snapshot replay & provenance" bodyClassName="space-y-4 p-4 sm:p-5">
        {score ? <>
          <p className="m-0 text-sm">Profile score {scoreValue(score.score)} · {levelLabel(score.level)} · Coverage {percent(score.coverage)}</p>
          <dl className="space-y-2 break-all text-xs"><div><dt className="text-muted-foreground">Frozen input hash</dt><dd className="m-0 font-mono">{score.inputHash}</dd></div>
            <div><dt className="text-muted-foreground">Frozen configuration hash</dt><dd className="m-0 font-mono">{score.configHash}</dd></div>
            <div><dt className="text-muted-foreground">Algorithm version / evaluation date</dt><dd className="m-0">{score.algorithmVersion} / {score.asOf}</dd></div></dl>
          <ScoreBreakdown snapshot={score} />
          <details className="rounded-lg border border-line-2 p-3"><summary className="cursor-pointer text-sm">Source content hashes</summary>
            <ul className="space-y-2 pl-4 text-xs">{score.sources.map((source) => <li key={source.source} className="break-all">{source.source}: <span className="font-mono">{source.contentHash ?? "Unavailable"}</span></li>)}</ul>
          </details>
          <ScoreHistory history={data.score?.history ?? []} />
        </> : <p className="m-0 text-sm text-muted-foreground">{userId ? "No scoring snapshot available for this user. Replay is untested." : "Select a user to inspect evidence, components, frozen hashes and source freshness."}</p>}
        <details className="rounded-lg border border-line-2 p-3"><summary className="cursor-pointer text-sm">Current methodology · {data.methodology.version}</summary>
          <p className="text-xs text-muted-foreground">Current configuration can differ from historical frozen snapshots.</p>
          <p className="text-xs">Minimum coverage {percent(data.methodology.thresholds.minimumCoverage)} · Minimum cohort {data.methodology.thresholds.minimumCohort}</p>
          <ul className="space-y-2 pl-4 text-xs">{LEVEL_OPTIONS.map((level) => {
            const weights = data.methodology.weights[level.value];
            return <li key={level.value}>{level.label}: {weights ? Object.entries(weights).map(([id, weight]) => `${id} ${percent(weight)}`).join(" · ") : "Rubric unavailable in this configuration"}</li>;
          })}</ul>
          <p className="text-xs text-muted-foreground">Normalizers: {Object.entries(data.methodology.normalizers).map(([key, value]) => `${key}: ${value}`).join(" · ")}</p>
        </details>
      </ConsoleCard>
      <ConsoleCard title="Weekly scoring receipts" bodyClassName="space-y-4 p-4 sm:p-5">
        <dl className="grid grid-cols-2 gap-3 text-xs">
          <div><dt className="text-muted-foreground">Scheduler</dt><dd className="m-0">{data.jobs.enabled ? "Enabled" : "Disabled"}</dd></div>
          <div><dt className="text-muted-foreground">Job status</dt><dd className="m-0">{data.jobs.status}</dd></div>
          <div><dt className="text-muted-foreground">Last started</dt><dd className="m-0">{data.jobs.lastStartedAt ?? "Never"}</dd></div>
          <div><dt className="text-muted-foreground">Last completed</dt><dd className="m-0">{data.jobs.lastCompletedAt ?? "Never"}</dd></div>
          <div><dt className="text-muted-foreground">Next due</dt><dd className="m-0">{data.jobs.nextDueAt ?? "Not scheduled"}</dd></div>
          <div><dt className="text-muted-foreground">Processed / failed</dt><dd className="m-0">{data.jobs.processed} / {data.jobs.failed}</dd></div>
        </dl>
        {data.jobs.lastError ? <p role="alert" className="text-sm text-destructive">Last scoring job failed. Inspect diagnostic checks and retry when resolved.</p> : null}
      </ConsoleCard>
    </> : null}

  </div>;
}
