"use client";

import * as React from "react";
import { toast } from "sonner";
import { HudCard, StatusDot } from "@/components/hud";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ApiFetchError } from "@/lib/api-client/client";
import {
  RUN_STATUS_DOT, collectRunExport, copyText, downloadJson, formatRunSummary, runControls, timeAgo,
  useAdminCompanies, useRunControl, useStartRun,
  type ResearchItem, type ResearchMode, type ResearchRun, type RunAction, type StartResearchRunRequest,
} from "@/features/research";

const MODES: ResearchMode[] = ["live", "record", "replay"];
const SELECT = "h-8 rounded-full border border-input bg-card px-3 font-mono text-[12px]";

function errorMessage(err: unknown): string {
  return err instanceof ApiFetchError ? err.message : "Request failed. Check the API logs.";
}

function runLabel(r: ResearchRun): string {
  const when = r.started_at ?? r.created_at;
  return `${r.run_id.slice(0, 8)} · ${r.status} · ${r.trigger} · ${timeAgo(when)}`;
}

/** Run picker, start (all / selected, by mode), pause / resume / stop, copy summary, export JSON. */
export function RunControlBar({
  runs,
  run,
  items,
  onSelectRun,
}: {
  runs: ResearchRun[];
  run: ResearchRun | undefined;
  items: ResearchItem[];
  onSelectRun: (runId: string) => void;
}) {
  const start = useStartRun();
  const control = useRunControl();
  const [confirmStop, setConfirmStop] = React.useState(false);
  const stopRef = React.useRef<HTMLButtonElement | null>(null);
  const wasConfirming = React.useRef(false);
  React.useEffect(() => {
    // The confirm button unmounts with focus; hand it back to Stop.
    if (wasConfirming.current && !confirmStop) stopRef.current?.focus();
    wasConfirming.current = confirmStop;
  }, [confirmStop]);
  const [mode, setMode] = React.useState<ResearchMode>("live");
  const controls = runControls(run?.status, start.isPending || control.isPending);
  const options = run && !runs.some((r) => r.run_id === run.run_id) ? [run, ...runs] : runs;

  const startRun = (body: StartResearchRunRequest) =>
    start.mutate(body, { onSuccess: (r) => onSelectRun(r.run_id), onError: (e) => toast.error(errorMessage(e)) });
  const act = (action: RunAction) => {
    if (run) control.mutate({ runId: run.run_id, action }, { onError: (e) => toast.error(errorMessage(e)) });
  };
  async function exportRun() {
    if (!run) return;
    try {
      downloadJson(`research-run-${run.run_id}.json`, await collectRunExport(run.run_id));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  return (
    <HudCard title="Research run" spotlight={false} meta={run ? <StatusDot state={RUN_STATUS_DOT[run.status]} label={run.status} /> : null}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {options.length > 0 ? (
            <select aria-label="Run" className={`${SELECT} max-w-[340px]`} value={run?.run_id ?? ""} onChange={(e) => onSelectRun(e.target.value)}>
              {options.map((r) => <option key={r.run_id} value={r.run_id}>{runLabel(r)}</option>)}
            </select>
          ) : null}
          <select aria-label="Mode" className={SELECT} value={mode} onChange={(e) => setMode(e.target.value as ResearchMode)}>
            {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <Button size="sm" disabled={!controls.start} onClick={() => startRun({ scope: "all", mode })}>Start all</Button>
          <StartSelected disabled={!controls.start} onStart={(ids) => startRun({ scope: "selected", companyIds: ids, mode })} />
          <Button size="sm" variant="strong" disabled={!controls.pause} onClick={() => act("pause")}>Pause</Button>
          <Button size="sm" variant="strong" disabled={!controls.resume} onClick={() => act("resume")}>Resume</Button>
          {confirmStop && controls.stop ? (
            <>
              <Button size="sm" variant="destructive" autoFocus onClick={() => { act("stop"); setConfirmStop(false); }}>Confirm stop</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmStop(false)}>Cancel</Button>
            </>
          ) : (
            <Button ref={stopRef} size="sm" variant="ghost" disabled={!controls.stop} onClick={() => setConfirmStop(true)}>Stop</Button>
          )}
          <div className="ml-auto flex flex-wrap gap-1.5">
            <Button size="sm" variant="ghost" disabled={!run} onClick={() => run && copyText(formatRunSummary(run, items), "Run summary copied")}>
              Copy run summary
            </Button>
            <Button size="sm" variant="ghost" disabled={!run} onClick={exportRun}>Export run JSON</Button>
          </div>
        </div>
        {run ? <RunFacts run={run} /> : null}
      </div>
    </HudCard>
  );
}

function RunFacts({ run }: { run: ResearchRun }) {
  const c = run.counters;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[11.5px] text-muted-foreground">
      <span>mode {run.mode}</span>
      <span>trigger {run.trigger}</span>
      <span>scope {run.scope}</span>
      <span>
        {c.total} total · {c.done} done · {c.skipped} skipped · {c.failed} failed · {c.running} running · {c.paused} paused · {c.queued} queued · {c.cancelled} cancelled
      </span>
      {run.started_at ? <span>started {timeAgo(run.started_at)}</span> : null}
      {run.pause_reason === "budget_exhausted" ? <span className="text-destructive">paused: budget cap reached. Raise a cap, then Resume</span> : null}
      {run.error ? <span className="text-destructive">error: {run.error}</span> : null}
    </div>
  );
}

function StartSelected({ disabled, onStart }: { disabled: boolean; onStart: (ids: string[]) => void }) {
  const companies = useAdminCompanies();
  const [open, setOpen] = React.useState(false);
  const [picked, setPicked] = React.useState<ReadonlySet<string>>(new Set());
  const active = (companies.data?.companies ?? []).filter((c) => c.status === "active");
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="strong" disabled={disabled}>Start selected…</Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <fieldset className="m-0 flex max-h-64 flex-col gap-1.5 overflow-y-auto border-0 p-0">
          <legend className="iq-eyebrow mb-2">Companies to research</legend>
          {active.length === 0 ? <p className="m-0 text-[13px] text-muted-foreground">No active companies. Add one on the Companies tab.</p> : null}
          {active.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
              {c.name}
            </label>
          ))}
        </fieldset>
        <Button
          size="sm"
          className="mt-3 w-full"
          disabled={picked.size === 0}
          onClick={() => {
            onStart([...picked]);
            setOpen(false);
            setPicked(new Set());
          }}
        >
          Start {picked.size > 0 ? picked.size : ""} selected
        </Button>
      </PopoverContent>
    </Popover>
  );
}
