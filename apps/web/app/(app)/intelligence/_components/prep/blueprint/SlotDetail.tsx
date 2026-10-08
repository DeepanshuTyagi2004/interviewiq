"use client";

import type { BlueprintSlot } from "@/features/blueprints";
import { shortHash } from "../format";
import { Collapsible, Facts, Lines, MonoBlock, Section } from "../ui";
import { AnswerKeyView } from "./AnswerKeyView";
import { BranchTable } from "./BranchTable";

/** Everything the interviewer has for one slot: the ask, hints, branches, probes, expectations, signals and key. */
export function SlotDetail({ slot, roundType }: { slot: BlueprintSlot; roundType: string }) {
  const clarifications = slot.ask.clarifications ?? [];
  const hints = [...slot.hint_ladder].sort((a, b) => (a.step ?? 0) - (b.step ?? 0));
  return (
    <div className="space-y-5">
      <Facts
        items={[
          ["Slot", `${slot.slot_id} · ${slot.kind} · order ${slot.order}`],
          ["Purpose", slot.purpose || "—"],
          ["Timebox", `${slot.timebox_mins} min`],
          ["Problem", (
            <span key="p">
              {slot.problem.title}
              <span className="block font-mono text-[11.5px] text-faint">
                {slot.problem.round_type}/{slot.problem.slug}
                {slot.problem.difficulty ? ` · ${slot.problem.difficulty}` : ""}
                {slot.problem.content_hash ? ` · ${shortHash(slot.problem.content_hash)}` : ""}
              </span>
            </span>
          )],
        ]}
      />

      <Section title="Opening">
        <blockquote className="m-0 border-l-2 border-line-3 pl-3 text-[13.5px] leading-[1.55]">{slot.ask.opening}</blockquote>
      </Section>

      {clarifications.length ? (
        <Section title={`Clarifications · ${clarifications.length}`}>
          <dl className="m-0 space-y-2 text-[13px]">
            {clarifications.map((c, i) => (
              <div key={i}>
                <dt className="leading-[1.5]">{c.question ?? "—"}</dt>
                <dd className="m-0 leading-[1.5] text-muted-foreground">{c.answer ?? "—"}</dd>
              </div>
            ))}
          </dl>
        </Section>
      ) : null}

      <Section title={`Hint ladder (gentle → explicit) · ${hints.length}`}>
        {hints.length ? (
          <ol className="m-0 space-y-1 pl-5 text-[13px] leading-[1.5]">
            {hints.map((h, i) => (
              <li key={i} value={h.step ?? i + 1}>{h.hint ?? "—"}</li>
            ))}
          </ol>
        ) : (
          <p className="m-0 text-xs text-faint">—</p>
        )}
      </Section>

      <Section title={`Branches · ${slot.branches.length}`}>
        <BranchTable branches={slot.branches} roundType={roundType} label={`Branches for ${slot.slot_id}`} />
      </Section>

      <div className="grid gap-4 sm:grid-cols-2">
        <Section title="Probes"><Lines items={slot.probes} /></Section>
        <Section title="Follow-ups"><Lines items={slot.follow_ups} /></Section>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Section title="Must show"><Lines items={slot.expectations.must_show} /></Section>
        <Section title="Strong signals"><Lines items={slot.expectations.strong_signals} /></Section>
        <Section title="Weak signals"><Lines items={slot.expectations.weak_signals} /></Section>
      </div>

      <Section title={`Evaluation signals · ${slot.evaluation_signals.length}`}>
        {slot.evaluation_signals.length ? (
          <ul className="m-0 space-y-1 pl-5 text-[13px] leading-[1.5]">
            {slot.evaluation_signals.map((e, i) => (
              <li key={i}>
                {e.signal ?? "—"}
                {e.observe ? <span className="text-muted-foreground"> · observe: {e.observe}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-xs text-faint">—</p>
        )}
      </Section>

      <Collapsible
        summary={`Answer key · ${slot.answer_key.cache_hit ? "cache hit" : "cache miss"}${slot.answer_key.key_version ? ` · ${slot.answer_key.key_version}` : ""}`}
      >
        <AnswerKeyView answerKey={slot.answer_key.key} />
      </Collapsible>

      <Collapsible summary="Problem content (snapshot)">
        <MonoBlock label="Problem content" text={JSON.stringify(slot.problem.content, null, 2)} />
      </Collapsible>
    </div>
  );
}
