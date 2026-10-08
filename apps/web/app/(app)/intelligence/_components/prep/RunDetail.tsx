"use client";

import * as React from "react";
import { HudCard, HudEmpty } from "@/components/hud";
import { useBlueprintRun, type BlueprintStageId } from "@/features/blueprints";
import { ApiFetchError } from "@/lib/api-client/client";
import { BlueprintViewer } from "./blueprint/BlueprintViewer";
import { BriefingCard } from "./blueprint/BriefingCard";
import { RunHeader } from "./RunHeader";
import { StageTimeline, orderedStages } from "./StageTimeline";
import { StageDrawer } from "./stages/StageDrawer";
import { VersionsDiff } from "./VersionsDiff";

/** Right pane: one run's header, stage timeline (with the stage drawer), blueprint and versions. */
export function RunDetail({ runId, onSelectRun }: { runId: string | null; onSelectRun: (id: string) => void }) {
  const q = useBlueprintRun(runId);
  const [stageId, setStageId] = React.useState<BlueprintStageId | null>(null);
  const run = q.data;
  const stages = React.useMemo(() => orderedStages(run?.stages), [run?.stages]);

  if (!runId) {
    return (
      <HudCard title="Run" spotlight={false}>
        <HudEmpty title="Pick a run" hint="Select a run on the left to see how its blueprint was built, stage by stage, or start a bench run." />
      </HudCard>
    );
  }
  if (q.isPending) {
    return (
      <HudCard title="Run" spotlight={false} bodyClassName="px-4 py-4 sm:px-5">
        <p className="m-0 text-[13px] text-muted-foreground">Loading run…</p>
      </HudCard>
    );
  }
  if (!run) {
    const notFound = q.error instanceof ApiFetchError && q.error.status === 404;
    return (
      <HudCard title="Run" spotlight={false} bodyClassName="px-4 py-4 sm:px-5">
        <p role="alert" className="m-0 text-[13px] text-destructive">
          {notFound ? "That run was not found. It may have expired (runs are kept for 30 days)." : `Could not load the run: ${q.error instanceof ApiFetchError ? q.error.message : "unknown error"}`}
        </p>
      </HudCard>
    );
  }

  const open = stageId ? (stages.find((s) => s.id === stageId) ?? null) : null;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {q.isError ? (
        <p role="alert" className="m-0 text-[13px] text-destructive">
          Could not refresh this run: {q.error instanceof ApiFetchError ? q.error.message : "unknown error"}
        </p>
      ) : null}
      <RunHeader run={run} onSelectRun={onSelectRun} />
      <StageTimeline stages={stages} onOpen={setStageId} />
      <StageDrawer run={run} stage={open} onClose={() => setStageId(null)} />
      {run.blueprint ? (
        <BlueprintViewer blueprint={run.blueprint} fallbackRoundType={run.round_type} />
      ) : run.briefing ? (
        <BriefingCard briefing={run.briefing} />
      ) : run.status === "completed" ? (
        <HudCard title="Blueprint" spotlight={false}>
          <HudEmpty title="No blueprint attached" hint="The run completed but its blueprint was not returned (it may have been purged)." />
        </HudCard>
      ) : null}
      {run.session_id ? <VersionsDiff sessionId={run.session_id} currentRunId={run.run_id} onSelectRun={onSelectRun} /> : null}
    </div>
  );
}
