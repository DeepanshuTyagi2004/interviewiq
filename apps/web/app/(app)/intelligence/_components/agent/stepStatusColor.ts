import type { Edge, Node } from "@xyflow/react";
import type { AgentTurn } from "@/features/agent-diagnostics";
import type { RunStepStatus } from "@/features/observability";

/**
 * Node chrome per step status, in the token palette (was raw hex fills). Same semantics:
 * idle = not reached this turn, pending = queued, running = live (brand), ok = done (ink hairline),
 * failed = destructive, skipped = muted panel. Brand/destructive are the only accents.
 */
export const STEP_STATUS_CLASS: Record<RunStepStatus | "idle", string> = {
  idle: "border-dashed border-line-3 bg-card text-faint",
  pending: "border-line-3 bg-card text-muted-foreground",
  running: "border-brand bg-card text-foreground ring-2 ring-brand/20",
  ok: "border-foreground bg-card text-foreground",
  failed: "border-destructive bg-destructive/10 text-destructive",
  skipped: "border-line-2 bg-panel text-faint",
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

// Tight enough that fitView keeps the mono labels legible across the card width.
const X_GAP = 116;

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
