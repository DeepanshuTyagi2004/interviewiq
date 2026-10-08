"use client";

import { LookPill } from "@/components/observability/ConsoleCard";
import { STEP_PILL } from "@/components/observability/status";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { BlueprintRunDetail, BlueprintStage } from "@/features/blueprints";
import { callTotals, formatCount, formatMs, inline } from "../format";
import { Collapsible, ErrorBox, Facts, MonoBlock, Section } from "../ui";
import { STAGE_LABEL, STAGE_ORDER, stepStatus } from "../vocabulary";
import { AnswerKeysStage } from "./AnswerKeysStage";
import { ContextStage } from "./ContextStage";
import { LlmCallList } from "./LlmCallList";
import { SelectionStage } from "./SelectionStage";
import { ValidateStage } from "./ValidateStage";

/** Right-side drawer with one stage's full trace. */
export function StageDrawer({
  run,
  stage,
  onClose,
}: {
  run: BlueprintRunDetail;
  stage: BlueprintStage | null;
  onClose: () => void;
}) {
  const index = stage ? STAGE_ORDER.indexOf(stage.id) : -1;
  const pill = stage ? STEP_PILL[stepStatus(stage.status)] : null;
  return (
    <Sheet open={stage != null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto border-line-2 bg-card p-0 sm:max-w-[min(1080px,94vw)] sm:rounded-l-[16px]"
      >
        {stage && pill ? (
          <div className="flex flex-col">
            <SheetHeader className="space-y-1.5 border-b border-line px-5 pb-4 pr-12 pt-5 text-left sm:px-6">
              <p className="iq-eyebrow m-0">
                Stage {index + 1} of {STAGE_ORDER.length} · {stage.id}
              </p>
              <SheetTitle className="text-xl font-normal tracking-[-0.03em]">{stage.label || STAGE_LABEL[stage.id]}</SheetTitle>
              <SheetDescription className="flex flex-wrap items-center gap-2 font-mono text-[12px]">
                <LookPill look={pill}>{pill.label}</LookPill>
                <span>{formatMs(stage.duration_ms)}</span>
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-5 px-5 py-5 sm:px-6">
              {stage.error ? <ErrorBox code={stage.error.code} message={stage.error.message} stage={stage.error.stage ?? null} /> : null}
              {stage.status === "pending" ? <p className="m-0 text-[13px] text-muted-foreground">This stage has not started.</p> : null}
              <StageBody run={run} stage={stage} />
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function StageBody({ run, stage }: { run: BlueprintRunDetail; stage: BlueprintStage }) {
  switch (stage.id) {
    case "context":
      return <ContextStage stage={stage} run={run} />;
    case "selection":
      return <SelectionStage stage={stage} />;
    case "answer_keys":
      return <AnswerKeysStage stage={stage} />;
    case "validate":
      return <ValidateStage stage={stage} />;
    case "policies":
      return <PoliciesStage stage={stage} />;
    default:
      return <LlmStage stage={stage} />;
  }
}

/** Stage 7: the policy template is the same for every interview; only its version matters here. */
function PoliciesStage({ stage }: { stage: BlueprintStage }) {
  const s = stage.summary ?? {};
  return (
    <Section title="Summary">
      <Facts
        items={[
          ["Policy version", typeof s.version === "string" ? s.version : inline(s.version)],
          ["Request rules", typeof s.requests === "number" ? String(s.requests) : "—"],
          ["Source", "Versioned template, no LLM"],
        ]}
      />
    </Section>
  );
}

/** Stages 4–6: the summary, the parsed output and every LLM call. */
function LlmStage({ stage }: { stage: BlueprintStage }) {
  const totals = callTotals(stage.llm_calls);
  const summary = Object.entries(stage.summary ?? {});
  const detail = stage.detail ?? {};
  return (
    <div className="space-y-5">
      <Section title="Summary">
        <Facts
          items={[
            ...summary.map(([k, v]): [string, string] => [k.replace(/_/g, " "), inline(v)]),
            ["Models", totals.models.join(", ") || "—"],
            ["Tokens", `${formatCount(totals.prompt)} in · ${formatCount(totals.completion)} out`],
          ]}
        />
      </Section>
      {Object.keys(detail).length ? (
        <Collapsible summary="Parsed output">
          <MonoBlock label="Parsed output" text={JSON.stringify(detail, null, 2)} />
        </Collapsible>
      ) : null}
      <LlmCallList calls={stage.llm_calls} />
    </div>
  );
}
