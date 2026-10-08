"use client";

import { BLUEPRINT_STATUSES, BLUEPRINT_TRIGGERS } from "@/lib/constants/blueprints";
import { cn } from "@/lib/utils/cn";
import { FIELD } from "./ui";
import { ROUND_TYPES, roundLabel } from "./vocabulary";

export interface RunFilterState {
  status: string;
  roundType: string;
  trigger: string;
  company: string;
  candidateId: string;
}

export const EMPTY_FILTERS: RunFilterState = { status: "", roundType: "", trigger: "", company: "", candidateId: "" };

/** Status, round type and trigger selects plus company and candidate text filters for the run list. */
export function RunFilters({ value, onChange }: { value: RunFilterState; onChange: (next: RunFilterState) => void }) {
  const set = (patch: Partial<RunFilterState>) => onChange({ ...value, ...patch });
  const active = Object.values(value).some(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Filter status" className={FIELD} value={value.status} onChange={(e) => set({ status: e.target.value })}>
        <option value="">Any status</option>
        {BLUEPRINT_STATUSES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <select aria-label="Filter round type" className={FIELD} value={value.roundType} onChange={(e) => set({ roundType: e.target.value })}>
        <option value="">Any round</option>
        {ROUND_TYPES.map((r) => (
          <option key={r} value={r}>{roundLabel(r)}</option>
        ))}
      </select>
      <select aria-label="Filter trigger" className={FIELD} value={value.trigger} onChange={(e) => set({ trigger: e.target.value })}>
        <option value="">Any trigger</option>
        {BLUEPRINT_TRIGGERS.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      <input
        aria-label="Filter company"
        placeholder="Company"
        className={cn(FIELD, "w-32 min-w-0 flex-1")}
        value={value.company}
        onChange={(e) => set({ company: e.target.value })}
      />
      <input
        aria-label="Filter candidate id"
        placeholder="Candidate id"
        className={cn(FIELD, "w-40 min-w-0 flex-1 font-mono text-[12px]")}
        value={value.candidateId}
        onChange={(e) => set({ candidateId: e.target.value })}
      />
      {active ? (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTERS)}
          className="rounded-full px-2 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
