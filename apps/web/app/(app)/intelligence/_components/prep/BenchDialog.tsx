"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useBenchCandidates, useStartBench, type BlueprintBenchRequest } from "@/features/blueprints";
import { ApiFetchError } from "@/lib/api-client/client";
import { cn } from "@/lib/utils/cn";
import { isUuid } from "./format";
import { ErrorBox } from "./ui";
import { ROUND_TYPES, roundLabel, type RoundType } from "./vocabulary";

const INPUT =
  "h-9 w-full rounded-lg border border-line-4 bg-card px-3 text-[13px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50";
const MAX_LISTED = 50;

type Source = "jd" | "loop";

interface FormState {
  search: string;
  candidateId: string;
  source: Source;
  jdId: string;
  loopId: string;
  nodeId: string;
  roundType: RoundType | "";
  bypassBlueprintCache: boolean;
  bypassAnswerKeyCache: boolean;
  ignoreExclusions: boolean;
}

const INITIAL: FormState = {
  search: "",
  candidateId: "",
  source: "jd",
  jdId: "",
  loopId: "",
  nodeId: "",
  roundType: "dsa",
  bypassBlueprintCache: false,
  bypassAnswerKeyCache: false,
  ignoreExclusions: false,
};

/** The request body for the form, or null while it is incomplete or invalid. */
function benchBody(f: FormState): BlueprintBenchRequest | null {
  if (!f.candidateId) return null;
  const options = {
    bypassBlueprintCache: f.bypassBlueprintCache,
    bypassAnswerKeyCache: f.bypassAnswerKeyCache,
    ignoreExclusions: f.ignoreExclusions,
  };
  if (f.source === "jd") {
    if (!isUuid(f.jdId) || !f.roundType) return null;
    return { candidateId: f.candidateId, jobDescriptionId: f.jdId.trim(), roundType: f.roundType, options };
  }
  if (!isUuid(f.loopId) || !f.nodeId.trim()) return null;
  return {
    candidateId: f.candidateId,
    loopId: f.loopId.trim(),
    nodeId: f.nodeId.trim(),
    ...(f.roundType ? { roundType: f.roundType } : {}),
    options,
  };
}

/**
 * "New run": prepare a blueprint by hand for any candidate, from a JD round or a practice loop node.
 * Bench runs never attach to a session and never touch anyone's seen list (spec §10).
 */
export function BenchDialog({
  open,
  onOpenChange,
  onStarted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarted: (runId: string) => void;
}) {
  const candidates = useBenchCandidates(open);
  const start = useStartBench();
  const [f, setF] = React.useState<FormState>(INITIAL);
  const set = (patch: Partial<FormState>) => setF((prev) => ({ ...prev, ...patch }));
  const ids = React.useId();

  const needle = f.search.trim().toLowerCase();
  const all = candidates.data ?? [];
  const matches = needle
    ? all.filter((c) => c.name.toLowerCase().includes(needle) || (c.email ?? "").toLowerCase().includes(needle) || c.id.startsWith(needle))
    : all;
  const listed = matches.slice(0, MAX_LISTED);
  const chosen = all.find((c) => c.id === f.candidateId);
  const body = benchBody(f);
  const jdInvalid = f.source === "jd" && f.jdId.trim() !== "" && !isUuid(f.jdId);
  const loopInvalid = f.source === "loop" && f.loopId.trim() !== "" && !isUuid(f.loopId);

  function close(next: boolean) {
    if (start.isPending) return;
    onOpenChange(next);
    if (!next) {
      setF(INITIAL);
      start.reset();
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body || start.isPending) return;
    start.mutate(body, {
      onSuccess: (r) => {
        onStarted(r.run_id);
        onOpenChange(false);
        setF(INITIAL);
        start.reset();
      },
    });
  }

  const err = start.error;
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] max-w-[560px] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New bench run</DialogTitle>
          <DialogDescription>
            Prepare a blueprint for any candidate and round. Bench runs never attach to a session and never touch the candidate&apos;s seen-before list.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="flex flex-col gap-5" aria-label="New bench run">
          <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0" disabled={start.isPending}>
            <legend className="iq-eyebrow mb-2">Candidate</legend>
            <input
              aria-label="Search candidates"
              placeholder="Search by name or email"
              className={INPUT}
              value={f.search}
              onChange={(e) => set({ search: e.target.value })}
            />
            {candidates.isPending ? (
              <p className="m-0 text-xs text-muted-foreground">Loading candidates…</p>
            ) : candidates.isError ? (
              <p role="alert" className="m-0 text-xs text-destructive">Could not load candidates.</p>
            ) : (
              <div role="radiogroup" aria-label="Candidate" className="max-h-48 overflow-y-auto rounded-[12px] border border-line-2">
                {listed.length === 0 ? <p className="m-0 px-3 py-2.5 text-xs text-muted-foreground">No candidate matches.</p> : null}
                {listed.map((c) => (
                  <label
                    key={c.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 border-b border-line px-3 py-2 text-[13px] last:border-b-0 hover:bg-accent",
                      c.id === f.candidateId && "bg-accent",
                    )}
                  >
                    <input
                      type="radio"
                      name={`${ids}-candidate`}
                      value={c.id}
                      checked={c.id === f.candidateId}
                      onChange={() => set({ candidateId: c.id })}
                      className="h-4 w-4 accent-brand"
                    />
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    {c.email ? <span className="min-w-0 truncate text-xs text-faint">{c.email}</span> : null}
                  </label>
                ))}
              </div>
            )}
            {matches.length > listed.length ? (
              <p className="m-0 text-xs text-faint">Showing {listed.length} of {matches.length}. Refine the search.</p>
            ) : null}
            {chosen ? (
              <p className="m-0 font-mono text-[11.5px] text-muted-foreground">
                {chosen.name} · {chosen.id}
              </p>
            ) : null}
          </fieldset>

          <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0" disabled={start.isPending}>
            <legend className="iq-eyebrow mb-2">Round</legend>
            <div role="radiogroup" aria-label="Round source" className="flex flex-wrap gap-4 text-[13px]">
              <label className="flex items-center gap-2">
                <input type="radio" name={`${ids}-source`} checked={f.source === "jd"} onChange={() => set({ source: "jd", roundType: f.roundType || "dsa" })} className="h-4 w-4 accent-brand" />
                Job description
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name={`${ids}-source`} checked={f.source === "loop"} onChange={() => set({ source: "loop" })} className="h-4 w-4 accent-brand" />
                Practice loop node
              </label>
            </div>

            {f.source === "jd" ? (
              <label className="flex flex-col gap-1.5 text-[13px]">
                JD id
                <input
                  aria-label="JD id"
                  aria-invalid={jdInvalid || undefined}
                  placeholder="00000000-0000-0000-0000-000000000000"
                  className={cn(INPUT, "font-mono text-[12px]")}
                  value={f.jdId}
                  onChange={(e) => set({ jdId: e.target.value })}
                />
                {jdInvalid ? <span className="text-xs text-destructive">Enter a JD id (a UUID).</span> : null}
              </label>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-[13px]">
                  Loop id
                  <input
                    aria-label="Loop id"
                    aria-invalid={loopInvalid || undefined}
                    className={cn(INPUT, "font-mono text-[12px]")}
                    value={f.loopId}
                    onChange={(e) => set({ loopId: e.target.value })}
                  />
                  {loopInvalid ? <span className="text-xs text-destructive">Enter a loop id (a UUID).</span> : null}
                </label>
                <label className="flex flex-col gap-1.5 text-[13px]">
                  Node id
                  <input aria-label="Node id" className={cn(INPUT, "font-mono text-[12px]")} value={f.nodeId} onChange={(e) => set({ nodeId: e.target.value })} />
                </label>
              </div>
            )}

            <label className="flex flex-col gap-1.5 text-[13px]">
              Round type
              <select
                aria-label="Round type"
                className={INPUT}
                value={f.roundType}
                onChange={(e) => set({ roundType: e.target.value as RoundType | "" })}
              >
                {f.source === "loop" ? <option value="">From the loop node</option> : null}
                {ROUND_TYPES.map((r) => (
                  <option key={r} value={r}>{roundLabel(r)}</option>
                ))}
              </select>
            </label>
          </fieldset>

          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" disabled={start.isPending}>
            <legend className="iq-eyebrow mb-2">Options</legend>
            <Check label="Bypass blueprint cache" checked={f.bypassBlueprintCache} onChange={(v) => set({ bypassBlueprintCache: v })} />
            <Check label="Bypass answer-key cache" checked={f.bypassAnswerKeyCache} onChange={(v) => set({ bypassAnswerKeyCache: v })} />
            <Check label="Ignore seen-before" checked={f.ignoreExclusions} onChange={(v) => set({ ignoreExclusions: v })} />
          </fieldset>

          {err ? (
            <ErrorBox
              code={err instanceof ApiFetchError ? (err.code ?? `HTTP ${err.status}`) : "request_failed"}
              message={err instanceof Error ? err.message : "Could not start the run."}
            />
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={start.isPending} onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!body || start.isPending}>
              {start.isPending ? <Loader2 aria-hidden className="animate-spin" /> : null}
              Start run
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-[13px]">
      <input type="checkbox" className="h-4 w-4 accent-brand" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
