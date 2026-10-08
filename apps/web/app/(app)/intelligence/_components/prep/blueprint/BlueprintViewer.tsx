"use client";

import { Download } from "lucide-react";
import { HudCard } from "@/components/hud";
import { Button } from "@/components/ui/button";
import type { Blueprint } from "@/features/blueprints";
import { asString, asStrings, downloadText, inline, isRecord, shortHash } from "../format";
import { CopyButton, Facts } from "../ui";
import { roundLabel } from "../vocabulary";
import { ArcTimeline } from "./ArcTimeline";
import { BriefingCard } from "./BriefingCard";
import { EvaluationCard } from "./EvaluationCard";
import { PersonaCard } from "./PersonaCard";
import { PersonalizationCard } from "./PersonalizationCard";
import { PoliciesCard } from "./PoliciesCard";
import { SlotList } from "./SlotList";
import { blueprintToMarkdown } from "./markdown";

/** The whole blueprint: round and provenance, persona, briefing, arc, personalization, slots, policies, signals. */
export function BlueprintViewer({ blueprint, fallbackRoundType }: { blueprint: Blueprint; fallbackRoundType: string }) {
  const round = blueprint.round ?? {};
  const roundType = asString(round.type) ?? fallbackRoundType;
  const duration = typeof round.duration_mins === "number" ? round.duration_mins : null;
  const prov = blueprint.provenance ?? {};
  const promptVersions = isRecord(prov.prompt_versions)
    ? Object.entries(prov.prompt_versions).map(([k, v]) => `${k} ${String(v)}`).join(" · ")
    : "—";
  const markdown = () => blueprintToMarkdown(blueprint);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <HudCard
        title="Blueprint"
        spotlight={false}
        meta={<span>v{blueprint.version} · {blueprint.status}</span>}
        bodyClassName="space-y-4 px-4 py-4 sm:px-5"
      >
        <Facts
          className="sm:grid-cols-[max-content_minmax(0,1fr)_max-content_minmax(0,1fr)]"
          items={[
            ["Round", `${roundLabel(roundType)}${asString(round.name) ? ` · ${asString(round.name)}` : ""}`],
            ["Duration", duration != null ? `${duration} min` : "—"],
            ["Format", asString(round.format) ?? "—"],
            ["Source", asString(round.source) ?? "—"],
            ["Difficulty", asString(round.difficulty_target) ?? "—"],
            ["Input hash", <span key="h" className="font-mono text-[12px]" title={blueprint.input_hash}>{shortHash(blueprint.input_hash)}</span>],
            ["Models", asStrings(prov.models).join(", ") || "—"],
            ["Prompts", promptVersions],
            ["Policy", inline(prov.policy_version)],
            ["Key version", inline(prov.key_version)],
            ["Seed", <span key="s" className="font-mono text-[12px]">{inline(prov.selection_seed)}</span>],
            ["Keys", `${inline(prov.answer_key_hits)} hit · ${inline(prov.answer_key_misses)} miss`],
          ]}
        />
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <CopyButton text={JSON.stringify(blueprint, null, 2)} what="Blueprint JSON copied" label="Copy JSON" />
          <CopyButton text={markdown()} what="Blueprint Markdown copied" label="Copy Markdown" />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2.5 text-[12px]"
            onClick={() => downloadText(`blueprint-${blueprint.session_id ?? "bench"}-v${blueprint.version}.md`, markdown())}
          >
            <Download aria-hidden />
            Export Markdown
          </Button>
        </div>
      </HudCard>

      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <PersonaCard persona={blueprint.persona} />
        <BriefingCard briefing={blueprint.briefing} />
      </div>
      <ArcTimeline arc={blueprint.arc} durationMins={duration} />
      <PersonalizationCard personalization={blueprint.personalization} />
      <SlotList slots={blueprint.slots} roundType={roundType} />
      <PoliciesCard policies={blueprint.policies} />
      <EvaluationCard evaluation={blueprint.evaluation} />
    </div>
  );
}
