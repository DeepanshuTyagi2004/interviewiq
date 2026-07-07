import type { Edge, Node } from "@xyflow/react";
import type { AgentTurn } from "@/features/agent-diagnostics";
import type { RunStepStatus } from "@/features/observability";

export const STEP_STATUS_COLOR: Record<RunStepStatus | "idle", string> = {
  idle: "#e5e7eb",
  pending: "#e5e7eb",
  running: "#fde68a",
  ok: "#86efac",
  failed: "#fca5a5",
  skipped: "#d1d5db",
};

/** Fixed interview pipeline — order and membership never change per-turn. */
export const PIPELINE_STEPS = [
  "stt",
  "classify",
  "scope",
  "grade",
  "pacing",
  "route",
  "action",
  "tts",
] as const;

export type PipelineStepName = (typeof PIPELINE_STEPS)[number];

/** Static edges connecting each fixed step to the next — the pipeline order never changes. */
export const PIPELINE_EDGES: Edge[] = PIPELINE_STEPS.slice(0, -1).map((name, index) => ({
  id: `${name}->${PIPELINE_STEPS[index + 1]}`,
  source: name,
  target: PIPELINE_STEPS[index + 1],
}));

export type PipelineNodeData = {
  label: PipelineStepName;
  status: RunStepStatus | "idle";
};

const X_GAP = 160;

/**
 * Pure mapping from one AgentTurn to react-flow nodes for the fixed pipeline.
 * A step present in turn.steps takes its status; a step absent from the turn
 * (not yet reached, or the turn doesn't exist) renders as "idle".
 * Extracted as a pure helper (rather than asserting on rendered react-flow
 * output) so it can be unit-tested without a DOM/ResizeObserver dependency.
 */
export function stepsToNodes(turn: AgentTurn | null | undefined): Node<PipelineNodeData>[] {
  return PIPELINE_STEPS.map((name, index) => {
    const step = turn?.steps.find((s) => s.name === name);
    return {
      id: name,
      type: "pipelineStep",
      position: { x: index * X_GAP, y: 0 },
      data: { label: name, status: step?.status ?? "idle" },
    };
  });
}
