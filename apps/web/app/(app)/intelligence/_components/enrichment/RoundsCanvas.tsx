"use client";

import { useMemo, useState } from "react";
import { Background, Controls, Position, ReactFlow, ReactFlowProvider, type Node, type NodeChange, type XYPosition } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { roundEdges, type EnrichmentRound } from "@/features/research/enrichment";

interface RoundsCanvasProps {
  rounds: EnrichmentRound[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  disabled: boolean;
  expanded?: boolean;
  positions?: Record<string, XYPosition>;
  onPositionsChange?: (positions: Record<string, XYPosition>) => void;
}

export function RoundsCanvas({ rounds, selectedId, onSelect, disabled, expanded = false, positions: controlledPositions, onPositionsChange }: RoundsCanvasProps) {
  const [internalPositions, setInternalPositions] = useState<Record<string, XYPosition>>({});
  const positions = controlledPositions ?? internalPositions;
  const canDrag = expanded && !disabled;
  const nodes = useMemo<Node[]>(() => rounds.map((round, i) => ({
    id: round.id, position: positions[round.id] ?? { x: i * 260, y: 70 },
    data: { label: <div className="text-left"><span className="font-mono text-[10px] text-muted-foreground">ROUND {String(i + 1).padStart(2, "0")} · {round.verified ? "VERIFIED" : "DRAFT"}</span><div className="mt-2 text-sm">{round.name || "Untitled round"}</div><div className="mt-1 font-mono text-xs text-muted-foreground">{round.type} · {round.durationMinutes} min</div></div> },
    selected: selectedId === round.id, sourcePosition: Position.Right, targetPosition: Position.Left,
    className: "nopan !w-[220px] !rounded-xl !border-line-3 !bg-card !p-4 !text-foreground [&.selected]:!border-brand",
  })), [rounds, positions, selectedId]);
  const edges = useMemo(() => roundEdges(rounds), [rounds]);
  const handleNodesChange = (changes: NodeChange[]) => {
    if (!canDrag) return;
    const nextPositions = { ...positions };
    let moved = false;
    for (const change of changes) {
      if (change.type === "position" && change.position) {
        nextPositions[change.id] = change.position;
        moved = true;
      }
    }
    if (!moved) return;
    if (controlledPositions === undefined) setInternalPositions(nextPositions);
    onPositionsChange?.(nextPositions);
  };

  return <div className={`flex w-full flex-col overflow-hidden rounded-xl border border-line-2 bg-panel [zoom:calc(1/var(--hud-zoom,1))] [--xy-edge-stroke:hsl(var(--faint))] [--xy-controls-button-background-color:hsl(var(--card))] [--xy-controls-button-color:hsl(var(--foreground))] ${expanded ? "h-full min-h-0" : "h-[340px] [&_.react-flow__pane]:!touch-auto [&_.react-flow__node]:!touch-auto"}`}>
    <div className="min-h-0 flex-1">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodesDraggable={canDrag}
          nodesConnectable={false}
          nodesFocusable={!disabled}
          edgesReconnectable={false}
          edgesFocusable={false}
          elementsSelectable={!disabled}
          selectNodesOnDrag={canDrag}
          selectionKeyCode={null}
          multiSelectionKeyCode={null}
          deleteKeyCode={null}
          zoomOnScroll={false}
          panOnScroll={expanded}
          preventScrolling={expanded}
          zoomOnPinch={expanded}
          zoomOnDoubleClick={false}
          zoomActivationKeyCode={null}
          panActivationKeyCode={null}
          panOnDrag={expanded}
          autoPanOnNodeFocus={expanded}
          autoPanOnNodeDrag={canDrag}
          onNodeClick={(_, node) => { if (!disabled) onSelect(node.id); }}
          onNodeDragStart={(_, node) => { if (canDrag) onSelect(node.id); }}
          onNodesChange={handleNodesChange}
          fitView
          minZoom={0.3}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          {expanded && <Controls showZoom showFitView showInteractive={false} />}
        </ReactFlow>
      </ReactFlowProvider>
    </div>
    <p className="shrink-0 border-t border-line-2 px-3 py-2 font-mono text-[10px] text-muted-foreground">
      {expanded ? "Scroll or drag the background to pan · Pinch or use + / − to zoom · Fit view to reset" : "Open fullscreen to pan, zoom, and arrange rounds."}
    </p>
  </div>;
}
