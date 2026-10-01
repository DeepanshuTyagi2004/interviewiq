"use client";
import dynamic from "next/dynamic";
import type { AgentStep, AgentTurn } from "@/features/agent-diagnostics";

// react-flow reads browser-only layout APIs; must not render during SSR/`next build`.
const PipelineCanvasInner = dynamic(() => import("./PipelineCanvasInner"), {
  ssr: false,
  loading: () => <div data-motion className="h-44 animate-pulse bg-panel" />,
});

/**
 * Fixed interview-pipeline canvas for one AgentTurn. Colors each step node from
 * that turn's steps[].status (a step absent from the turn renders as idle) and
 * calls onSelectStep(step) when a node is clicked — undefined for steps that
 * haven't run yet in this turn.
 */
export function PipelineCanvas({
  turn,
  onSelectStep,
}: {
  turn: AgentTurn | null | undefined;
  onSelectStep: (step: AgentStep | undefined) => void;
}) {
  return <PipelineCanvasInner turn={turn} onSelectStep={onSelectStep} />;
}
