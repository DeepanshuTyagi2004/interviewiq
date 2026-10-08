"use client";

import { LookPill } from "@/components/observability/ConsoleCard";
import { OUTLINE_PILL } from "@/components/observability/status";
import type { BlueprintStage } from "@/features/blueprints";
import { AnswerKeyView } from "../blueprint/AnswerKeyView";
import { asString, isRecord } from "../format";
import { Collapsible, Facts, Section } from "../ui";
import { LlmCallList } from "./LlmCallList";

/**
 * Stage 3: per slot, the problem's key, whether it came from the cache, its version, and the key
 * itself; then every key-writing LLM call and sandbox check (repairs and swaps included).
 */
export function AnswerKeysStage({ stage }: { stage: BlueprintStage }) {
  const s = stage.summary ?? {};
  const detail = stage.detail ?? {};
  const keys = isRecord(detail.keys) ? Object.entries(detail.keys).filter((e): e is [string, Record<string, unknown>] => isRecord(e[1])) : [];

  return (
    <div className="space-y-5">
      <Section title="Summary">
        <Facts
          items={[
            ["Cache hits", typeof s.hits === "number" ? String(s.hits) : "—"],
            ["Misses", typeof s.misses === "number" ? String(s.misses) : "—"],
            ["Swaps", typeof s.swaps === "number" ? String(s.swaps) : "—"],
          ]}
        />
      </Section>

      <Section title={`Keys · ${keys.length}`}>
        {keys.length === 0 ? <p className="m-0 text-xs text-faint">No keys recorded.</p> : null}
        <ul className="m-0 list-none space-y-2 p-0">
          {keys.map(([slotId, k]) => {
            const hit = k.cache_hit === true;
            const key = isRecord(k.key) ? k.key : null;
            return (
              <li key={slotId} className="space-y-2 rounded-[12px] border border-line-2 px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-[12.5px]">{slotId}</span>
                  <span className="min-w-0 font-mono text-[12.5px] text-muted-foreground [overflow-wrap:anywhere]">{asString(k.slug) ?? "—"}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <LookPill look={hit ? { tone: "soft" } : OUTLINE_PILL}>{hit ? "cache hit" : "cache miss"}</LookPill>
                    <span className="font-mono text-[11.5px] text-faint">{asString(k.key_version) ?? "—"}</span>
                  </span>
                </div>
                <Collapsible summary="Answer key">
                  <AnswerKeyView answerKey={key} />
                </Collapsible>
              </li>
            );
          })}
        </ul>
      </Section>

      <LlmCallList calls={stage.llm_calls} />
    </div>
  );
}
