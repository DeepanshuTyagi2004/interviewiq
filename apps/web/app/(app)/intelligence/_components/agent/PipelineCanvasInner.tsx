"use client";
import { useCallback, useMemo } from "react";
import { Background, ReactFlow, ReactFlowProvider, type NodeMouseHandler } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { AgentStep, AgentTurn } from "@/features/agent-diagnostics";
import { PipelineNode } from "./PipelineNode";
import { PIPELINE_EDGES, stepsToNodes } from "./stepStatusColor";

// Stable ref required by react-flow — must not be redefined on every render.
const nodeTypes = { pipelineStep: PipelineNode };

/**
 * Actual react-flow canvas. Loaded client-only via PipelineCanvas's dynamic()
 * import (react-flow reads layout/ResizeObserver APIs unavailable during SSR).
 */
export default function PipelineCanvasInner({
  turn,
  onSelectStep,
}: {
  turn: AgentTurn | null | undefined;
  onSelectStep: (step: AgentStep | undefined) => void;
}) {
  const nodes = useMemo(() => stepsToNodes(turn), [turn]);

  const handleNodeClick = useCallback<NodeMouseHandler>(
    (_event, node) => {
      const step = turn?.steps.find((s) => s.name === node.id);
      onSelectStep(step);
    },
    [turn, onSelectStep]
  );

  return (
    <div className="h-64">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={PIPELINE_EDGES}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          zoomOnScroll={false}
          panOnDrag={false}
          zoomOnDoubleClick={false}
          fitView
          onNodeClick={handleNodeClick}
        >
          <Background />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
