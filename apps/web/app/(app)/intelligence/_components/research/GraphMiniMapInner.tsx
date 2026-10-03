"use client";

import { useId, useMemo } from "react";
import { Position, ReactFlow, ReactFlowProvider, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { nodeStates, type NodeState, type ResearchItem } from "@/features/research";

const NODE_CLASS: Record<NodeState, string> = {
  idle: "border-dashed border-line-3 bg-card text-faint",
  running: "border-brand bg-card text-foreground ring-2 ring-brand/20 motion-safe:animate-[iq-breathe_1.4s_ease-in-out_infinite]",
  ok: "border-faint-2 bg-card text-foreground",
  error: "border-destructive bg-destructive/10 text-destructive",
};

export default function GraphMiniMapInner({ item }: { item: ResearchItem }) {
  const id = useId();
  const summary = useMemo(() => nodeStates(item).map(({ name, state }) => `${name}: ${state}`).join(", "), [item]);
  const nodes = useMemo<Node[]>(
    () =>
      nodeStates(item).map(({ name, state }, i) => ({
        id: name,
        position: { x: i * 160, y: 0 },
        data: { label: name.replace(/_/g, " ") },
        draggable: false,
        selectable: false,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        className: `!w-auto !rounded-full !border !px-3 !py-1 !font-mono !text-[11px] ${NODE_CLASS[state]}`,
      })),
    [item],
  );
  const edges = useMemo<Edge[]>(() => nodes.slice(1).map((node, i) => ({ id: `${nodes[i]!.id}->${node.id}`, source: nodes[i]!.id, target: node.id })), [nodes]);
  // Same HUD-zoom inversion as PipelineCanvasInner: React Flow must run at an effective zoom of 1.
  return (
    <div className="h-14">
      <span className="sr-only">{summary}</span>
      <div className="h-full [zoom:calc(1/var(--hud-zoom,1))]">
        <div className="h-full [--xy-attribution-background-color:transparent] [--xy-edge-stroke:hsl(var(--line-4))]">
          <ReactFlowProvider>
            <ReactFlow
              id={id}
              nodesFocusable={false}
              edgesFocusable={false}
              nodes={nodes}
              edges={edges}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              zoomOnScroll={false}
              panOnDrag={false}
              zoomOnDoubleClick={false}
              preventScrolling={false}
              fitView
              proOptions={{ hideAttribution: true }}
            />
          </ReactFlowProvider>
        </div>
      </div>
    </div>
  );
}
