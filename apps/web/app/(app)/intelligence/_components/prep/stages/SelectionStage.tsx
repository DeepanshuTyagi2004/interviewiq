"use client";

import * as React from "react";
import { LookPill } from "@/components/observability/ConsoleCard";
import { HairlineTable, Td, Th, Tr } from "@/components/observability/HairlineTable";
import type { BlueprintStage, SelectionCandidateRow, SelectionSlotTrace } from "@/features/blueprints";
import { isRecord } from "../format";
import { FIELD, Facts, Section } from "../ui";
import { BREAKDOWN_COLUMNS, OUTCOMES, OUTCOME_META, type SelectionOutcome } from "../vocabulary";

/** "40" / "12.5" / "0.75": points without trailing zeros. */
function pts(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return String(Math.round(n * 100) / 100);
}

/** The untyped `detail.slots` payload, as the selection trace rows (spec §7.8). */
function slotsOf(stage: BlueprintStage): SelectionSlotTrace[] {
  const raw = stage.detail?.slots;
  return Array.isArray(raw) ? (raw.filter(isRecord) as unknown as SelectionSlotTrace[]) : [];
}

/**
 * Stage 2: per slot, every candidate considered with its total score, its score breakdown (named,
 * company, topic, difficulty, level, popularity) and why it won or lost; relaxations and swaps on top.
 */
export function SelectionStage({ stage }: { stage: BlueprintStage }) {
  const [outcome, setOutcome] = React.useState<SelectionOutcome | "">("");
  const slots = slotsOf(stage);
  const s = stage.summary ?? {};
  const detail = stage.detail ?? {};
  const weights = isRecord(detail.weights) ? detail.weights : null;
  const relaxed = Array.isArray(s.relaxed_slots) ? s.relaxed_slots.map(String) : [];

  return (
    <div className="space-y-5">
      <Section title="Summary">
        <Facts
          items={[
            ["Pool", typeof s.pool === "number" ? `${s.pool} problems` : "—"],
            ["Seen before", typeof s.excluded_seen === "number" ? `${s.excluded_seen} excluded` : "—"],
            ["Other company", typeof s.other_company === "number" ? `${s.other_company} written for another company` : "—"],
            ["Unsuitable", typeof s.unsuitable === "number" ? `${s.unsuitable} (intro, assumes a job, or named but off-title)` : "—"],
            ["Slots", typeof s.slots === "number" ? String(s.slots) : String(slots.length)],
            ["Relaxed", relaxed.length ? relaxed.join(", ") : "none"],
          ]}
        />
        {weights ? (
          <p className="m-0 font-mono text-[11.5px] text-faint">
            Weights: {Object.entries(weights).map(([k, v]) => `${k} ${String(v)}`).join(" · ")}
          </p>
        ) : null}
      </Section>

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Filter outcome"
          className={FIELD}
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as SelectionOutcome | "")}
        >
          <option value="">All outcomes</option>
          {OUTCOMES.map((o) => (
            <option key={o} value={o}>{OUTCOME_META[o].label}</option>
          ))}
        </select>
      </div>

      {slots.length === 0 ? <p className="m-0 text-xs text-faint">No selection trace recorded.</p> : null}
      {slots.map((slot) => (
        <SlotSelection key={slot.slot_id} slot={slot} outcome={outcome} />
      ))}
    </div>
  );
}

function SlotSelection({ slot, outcome }: { slot: SelectionSlotTrace; outcome: SelectionOutcome | "" }) {
  const rows = (slot.candidates ?? []).filter((c) => !outcome || c.outcome === outcome);
  const headingId = React.useId();
  return (
    <section aria-labelledby={headingId} className="space-y-2 rounded-[14px] border border-line-2 p-3 sm:p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id={headingId} className="m-0 font-mono text-[13px] font-normal">
          {slot.slot_id}
          <span className="text-faint"> · {slot.kind}</span>
        </h3>
        {slot.purpose ? <span className="text-[13px] text-muted-foreground">{slot.purpose}</span> : null}
        <span className="ml-auto font-mono text-[12px]">
          <span className="text-faint">picked </span>
          {slot.picked ?? "—"}
        </span>
      </div>
      {slot.relaxations?.length ? (
        <p className="m-0 text-xs text-muted-foreground">
          <span className="text-faint">Relaxed: </span>
          {slot.relaxations.join(" → ")}
        </p>
      ) : null}
      {slot.swaps?.length ? (
        <ul className="m-0 list-none space-y-0.5 p-0 text-xs">
          {slot.swaps.map((sw, i) => (
            <li key={i} className="text-destructive [overflow-wrap:anywhere]">
              <span className="font-mono">Swapped out {sw.slug}</span>
              <span className="text-muted-foreground">: {sw.reason}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {rows.length === 0 ? (
        <p className="m-0 text-xs text-faint">{outcome ? "No candidate with this outcome." : "No candidates recorded."}</p>
      ) : (
        <CandidateTable slotId={slot.slot_id} rows={rows} />
      )}
    </section>
  );
}

function CandidateTable({ slotId, rows }: { slotId: string; rows: SelectionCandidateRow[] }) {
  return (
    <HairlineTable label={`Candidates for ${slotId}`} className="min-w-[980px] text-[12.5px]">
      <thead>
        <tr>
          <Th colSpan={4} />
          <Th colSpan={BREAKDOWN_COLUMNS.length} className="border-b border-line text-center">Score breakdown</Th>
          <Th colSpan={2} />
        </tr>
        <tr className="border-b border-line-2">
          <Th>Problem</Th>
          <Th>Bank difficulty</Th>
          <Th>Primary</Th>
          <Th className="text-right">Total</Th>
          {BREAKDOWN_COLUMNS.map((c) => (
            <Th key={c.key} className="text-right">{c.label}</Th>
          ))}
          <Th>Outcome</Th>
          <Th>Reason</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const meta = OUTCOME_META[r.outcome] ?? { label: r.outcome, look: { tone: "ghost" as const } };
          return (
            <Tr key={r.slug} className={r.outcome === "picked" ? "bg-accent" : undefined}>
              <Td className="max-w-[260px] py-2">
                <span className="block truncate" title={r.title}>{r.title}</span>
                <span className="block truncate font-mono text-[11px] text-faint" title={r.slug}>{r.slug}</span>
              </Td>
              <Td className="py-2">{r.difficulty ?? "—"}</Td>
              <Td className="py-2">
                <span className="font-mono text-[11.5px]">{r.primary || "—"}</span>
                {r.category && r.category !== r.primary ? <span className="block text-[11px] text-faint">{r.category}</span> : null}
              </Td>
              <Td className="py-2 text-right font-mono tabular-nums">{pts(r.score)}</Td>
              {BREAKDOWN_COLUMNS.map((c) => (
                <Td key={c.key} className="py-2 text-right font-mono tabular-nums text-muted-foreground">
                  {pts(r.breakdown?.[c.key])}
                </Td>
              ))}
              <Td className="py-2">
                <LookPill look={meta.look}>{meta.label}</LookPill>
              </Td>
              <Td className="min-w-[200px] py-2 text-muted-foreground">{r.reason || "—"}</Td>
            </Tr>
          );
        })}
      </tbody>
    </HairlineTable>
  );
}
