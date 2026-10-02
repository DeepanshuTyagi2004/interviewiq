"use client";

import * as React from "react";
import { toast } from "sonner";
import { HudCard, SegmentMeter } from "@/components/hud";
import { HeaderCount } from "@/components/observability/ConsoleCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiFetchError } from "@/lib/api-client/client";
import { useRaiseBudget, type ResearchRun } from "@/features/research";

function Meter({ label, used, cap }: { label: string; used: number; cap: number }) {
  const ratio = cap > 0 ? used / cap : 1;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="iq-eyebrow">{label}</span>
        <span className="font-mono text-[12px] tabular-nums">{used} / {cap}</span>
      </div>
      <SegmentMeter segments={20} filled={ratio * 20} tone={ratio >= 1 ? "brand" : "ink"} label={`${label}: ${used} of ${cap} used`} />
    </div>
  );
}

/** Exa / LLM calls used vs cap, plus tokens. Reaching a cap auto-pauses the run; raise it here, then Resume. */
export function BudgetMeters({ run }: { run: ResearchRun }) {
  const b = run.budget;
  return (
    <HudCard
      title="Budget"
      spotlight={false}
      meta={<HeaderCount>{b.tokens_in.toLocaleString()} in · {b.tokens_out.toLocaleString()} out tokens</HeaderCount>}
    >
      <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <Meter label="Exa searches" used={b.exa_used} cap={b.exa_cap} />
        <Meter label="LLM calls" used={b.llm_used} cap={b.llm_cap} />
        {/* Keyed on the server caps so the inputs reset when the caps change, without an effect. */}
        <CapsForm key={`${run.run_id}-${b.exa_cap}-${b.llm_cap}`} run={run} />
      </div>
    </HudCard>
  );
}

function CapsForm({ run }: { run: ResearchRun }) {
  const raise = useRaiseBudget();
  const b = run.budget;
  const [exaCap, setExaCap] = React.useState(String(b.exa_cap));
  const [llmCap, setLlmCap] = React.useState(String(b.llm_cap));

  function save(e: React.FormEvent) {
    e.preventDefault();
    raise.mutate(
      { runId: run.run_id, exaCap: Number(exaCap), llmCap: Number(llmCap) },
      {
        onSuccess: () => toast.success("Budget caps updated"),
        onError: (err) => toast.error(err instanceof ApiFetchError ? err.message : "Could not update the caps"),
      },
    );
  }

  return (
    <form onSubmit={save} aria-label="Set budget caps" className="flex items-end gap-2">
      <div className="grid gap-1">
        <Label htmlFor="exa-cap" className="text-[11px]">Exa cap</Label>
        <Input id="exa-cap" type="number" min={b.exa_used} value={exaCap} onChange={(e) => setExaCap(e.target.value)} className="h-8 w-24 font-mono text-[12px]" />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="llm-cap" className="text-[11px]">LLM cap</Label>
        <Input id="llm-cap" type="number" min={b.llm_used} value={llmCap} onChange={(e) => setLlmCap(e.target.value)} className="h-8 w-24 font-mono text-[12px]" />
      </div>
      <Button size="sm" variant="strong" type="submit" disabled={raise.isPending}>Set caps</Button>
    </form>
  );
}
