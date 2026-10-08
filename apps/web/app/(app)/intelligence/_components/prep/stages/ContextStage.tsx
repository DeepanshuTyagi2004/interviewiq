"use client";

import type { ReactNode } from "react";
import { MonoPill } from "@/components/patterns";
import { HairlineHead, HairlineTable, Td, Th, Tr } from "@/components/observability/HairlineTable";
import { useBlueprintVersions, type BlueprintRunDetail, type BlueprintStage } from "@/features/blueprints";
import { asString, asStrings, isRecord, shortHash } from "../format";
import { CopyButton, Facts, Lines, Section } from "../ui";
import { roundLabel } from "../vocabulary";

const SOURCE_LABEL: Record<string, string> = { round: "Round topics", company: "Company dominant topics", jd: "JD text" };

/**
 * Stage 1: the resolved round (type, level, difficulty target and window, target topics, named
 * problems, exclusions), where each topic came from, and the fingerprint parts. On a session run
 * the parts are compared with the previous blueprint version, so a refresh shows what changed.
 */
export function ContextStage({ stage, run }: { stage: BlueprintStage; run: BlueprintRunDetail }) {
  const s = stage.summary ?? {};
  const d = stage.detail ?? {};
  const span = asStrings(s.difficulty_window);
  const topics = asStrings(s.target_topics);
  const named = asStrings(s.named_problems);
  const sources = isRecord(d.topic_sources) ? d.topic_sources : {};
  const parts: Record<string, string> = isRecord(d.input_parts)
    ? Object.fromEntries(Object.entries(d.input_parts).map(([k, v]) => [k, String(v ?? "")]))
    : (run.input_parts ?? {});
  const fingerprint = asString(d.input_hash) ?? run.input_hash ?? null;
  const previous = usePreviousParts(run);

  return (
    <div className="space-y-5">
      <Section title="Resolved round">
        <Facts
          items={[
            ["Round", `${roundLabel(asString(s.round_type) ?? run.round_type)}${asString(s.family) ? ` · ${asString(s.family)} family` : ""}`],
            ["Duration", typeof s.duration_mins === "number" ? `${s.duration_mins} min` : "—"],
            ["Level", `${asString(s.level_label) ?? run.level}${asString(s.level) ? ` (${asString(s.level)})` : ""}`],
            ["Difficulty", `target ${asString(s.difficulty_target) ?? "—"}${span.length === 2 ? ` · window ${span[0]}–${span[1]}` : ""}`],
            ["Company", asString(s.company) ?? run.company],
            ["Exclusions", typeof s.exclusions === "number" ? `${s.exclusions} slug${s.exclusions === 1 ? "" : "s"}` : "—"],
            ["Behavioural part", s.behavioural_part === true ? "yes: two behavioural questions open the round" : "no"],
            ["Round questions part", s.round_questions_part === true ? "yes: one coding problem, the rest for the round's own questions" : "no"],
          ]}
        />
      </Section>

      <Section title={`Target topics · ${topics.length}`}>
        {topics.length ? (
          <div className="flex flex-wrap gap-1.5">
            {topics.map((t) => (
              <MonoPill key={t}>{t}</MonoPill>
            ))}
          </div>
        ) : (
          <p className="m-0 text-xs text-faint">No canonical topics matched.</p>
        )}
      </Section>

      <Section title={`Named problems · ${named.length}`}>
        <Lines items={named} />
      </Section>

      <Section title="Topic sources">
        {Object.keys(sources).length ? (
          <Facts
            items={Object.entries(sources).map(([k, v]): [string, ReactNode] => [
              SOURCE_LABEL[k] ?? k,
              asStrings(v).length ? <span className="font-mono text-[12px]">{asStrings(v).join(", ")}</span> : <span className="text-faint">none</span>,
            ])}
          />
        ) : (
          <p className="m-0 text-xs text-faint">—</p>
        )}
      </Section>

      <Section
        title="Fingerprint"
        action={fingerprint ? <CopyButton text={fingerprint} what="Fingerprint copied" label="Copy hash" /> : null}
      >
        <p className="m-0 font-mono text-[12px] [overflow-wrap:anywhere]">{fingerprint ?? "—"}</p>
        {previous ? (
          <p className="m-0 text-xs text-muted-foreground">Compared with blueprint v{previous.version}.</p>
        ) : null}
        {Object.keys(parts).length ? (
          <HairlineTable label="Fingerprint parts">
            <HairlineHead>
              <Th>Part</Th>
              <Th>Hash</Th>
              <Th className="text-right">Change</Th>
            </HairlineHead>
            <tbody>
              {Object.entries(parts).map(([part, hash]) => {
                const changed = previous ? previous.parts[part] !== hash : false;
                return (
                  <Tr key={part} className={changed ? "bg-accent" : undefined}>
                    <Td className="font-mono text-[12px]">{part}</Td>
                    <Td className="font-mono text-[12px]" title={hash}>{shortHash(hash, 16)}</Td>
                    <Td className="text-right">{changed ? <MonoPill tone="ink">changed</MonoPill> : <span className="text-xs text-faint">—</span>}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </HairlineTable>
        ) : null}
      </Section>
    </div>
  );
}

/** The fingerprint parts of the session's previous blueprint version (before this run), if any. */
function usePreviousParts(run: BlueprintRunDetail): { version: number; parts: Record<string, string> } | null {
  const versions = useBlueprintVersions(run.session_id ?? null);
  const list = versions.data?.versions ?? [];
  const before = list
    .filter((v) => v.run_id !== run.run_id && v.version != null && (!v.created_at || v.created_at <= run.created_at))
    .sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0];
  if (!before?.input_parts || before.version == null) return null;
  return { version: before.version, parts: before.input_parts };
}
