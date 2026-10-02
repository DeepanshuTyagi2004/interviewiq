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

  // The outer box keeps the h-44 slot in the page's (zoomed) units. Inside it, the wrapper undoes the
  // HUD root zoom (0.9) so React Flow runs at an effective zoom of 1: under the root zoom it mixes
  // zoomed and unzoomed measurements and anchors edges ~10% inside their source nodes. Percentage
  // heights ignore zoom, so h-full fills the same on-screen box.
  // Token palette for react-flow's own chrome (edges, handles, attribution) via its CSS variables,
  // so the canvas follows light/dark with the rest of the app.
  return (
    <div className="h-44">
      <div className="h-full [zoom:calc(1/var(--hud-zoom,1))]">
        <div className="h-full [--xy-attribution-background-color:transparent] [--xy-edge-stroke-width:1.25] [--xy-edge-stroke:hsl(var(--line-4))] [--xy-handle-background-color:hsl(var(--line-4))] [--xy-handle-border-color:hsl(var(--card))]">
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
              <Background color="hsl(var(--line-3))" gap={16} size={1} />
            </ReactFlow>
          </ReactFlowProvider>
        </div>
      </div>
    </div>
  );
}
