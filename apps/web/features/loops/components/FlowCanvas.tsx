"use client";

import { useCallback, useEffect, useMemo, useRef, type DragEvent } from "react";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { cn } from "@/lib/utils/cn";
import { isRound, wouldCreateCycle } from "../graph";
import type { LoopNodeState, ProcessGraph } from "../types";
import { InfoFlowNodeView, RoundFlowNodeView, type InfoFlowNodeT, type RoundFlowNode } from "./FlowNodes";

export const PALETTE_MIME = "application/x-interviewiq-node";

const nodeTypes = { round: RoundFlowNodeView, info: InfoFlowNodeView };

export interface FlowCanvasProps {
  graph: ProcessGraph;
  /** `view` is read-only; `edit` lets you drag, connect, delete and drop palette items. */
  mode: "view" | "edit";
  /** Per-round state of a confirmed loop (view mode). */
  nodeStates?: Record<string, LoopNodeState>;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onGraphChange?: (graph: ProcessGraph) => void;
  onBookNode?: (nodeId: string) => void;
  /** Called with a palette payload and the flow position it was dropped at (edit mode). */
  onDropPreset?: (payload: string, position: { x: number; y: number }) => void;
  className?: string;
}

function Inner({ graph, mode, nodeStates, selectedId, onSelect, onGraphChange, onBookNode, onDropPreset, className }: FlowCanvasProps) {
  const editable = mode === "edit";
  const { screenToFlowPosition, fitView } = useReactFlow();

  // Re-fit when nodes are added or removed, so a new round is never off-screen.
  const count = graph.nodes.length;
  const prevCount = useRef(count);
  useEffect(() => {
    if (prevCount.current === count) return;
    prevCount.current = count;
    const id = requestAnimationFrame(() => void fitView({ padding: 0.2, maxZoom: 1, duration: 250 }));
    return () => cancelAnimationFrame(id);
  }, [count, fitView]);

  const roundIndex = useMemo(() => {
    const ordered = graph.nodes.filter(isRound);
    // Order rounds left to right so "Round 01" matches what the eye reads.
    ordered.sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
    return new Map(ordered.map((n, i) => [n.id, i]));
  }, [graph.nodes]);

  const nodes = useMemo<Node[]>(
    () =>
      graph.nodes.map((n) =>
        n.kind === "round"
          ? ({
              id: n.id, type: "round", position: n.position, selected: selectedId === n.id,
              deletable: editable, draggable: editable, connectable: editable,
              data: { node: n, index: roundIndex.get(n.id) ?? 0, state: nodeStates?.[n.id], editable, onBook: onBookNode },
            } satisfies RoundFlowNode)
          : ({
              id: n.id, type: "info", position: n.position, selected: selectedId === n.id,
              deletable: editable, draggable: editable, connectable: false, data: { node: n },
            } satisfies InfoFlowNodeT),
      ),
    [graph.nodes, roundIndex, nodeStates, selectedId, editable, onBookNode],
  );

  const edges = useMemo<Edge[]>(
    () => graph.edges.map((e) => ({
      id: `${e.source}>${e.target}`, source: e.source, target: e.target, type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed }, deletable: editable, selectable: editable,
    })),
    [graph.edges, editable],
  );

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    if (!editable || !onGraphChange) return;
    let next = graph;
    for (const c of changes) {
      if (c.type === "position" && c.position) {
        const pos = c.position;
        next = { ...next, nodes: next.nodes.map((n) => (n.id === c.id ? { ...n, position: pos } : n)) };
      } else if (c.type === "remove") {
        next = {
          nodes: next.nodes.filter((n) => n.id !== c.id),
          edges: next.edges.filter((e) => e.source !== c.id && e.target !== c.id),
        };
      }
    }
    if (next !== graph) onGraphChange(next);
  }, [editable, graph, onGraphChange]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (!editable || !onGraphChange) return;
    const removed = new Set(changes.filter((c) => c.type === "remove").map((c) => c.id));
    if (removed.size === 0) return;
    onGraphChange({ ...graph, edges: graph.edges.filter((e) => !removed.has(`${e.source}>${e.target}`)) });
  }, [editable, graph, onGraphChange]);

  const onConnect = useCallback((c: Connection) => {
    if (!editable || !onGraphChange || !c.source || !c.target) return;
    if (graph.edges.some((e) => e.source === c.source && e.target === c.target)) return;
    if (wouldCreateCycle(graph, c.source, c.target)) return;
    onGraphChange({ ...graph, edges: [...graph.edges, { source: c.source, target: c.target }] });
  }, [editable, graph, onGraphChange]);

  const isValidConnection = useCallback(
    (c: Connection | Edge) => !!c.source && !!c.target && !wouldCreateCycle(graph, c.source, c.target),
    [graph],
  );

  const onDragOver = (e: DragEvent) => {
    if (!editable) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDrop = (e: DragEvent) => {
    if (!editable || !onDropPreset) return;
    const payload = e.dataTransfer.getData(PALETTE_MIME);
    if (!payload) return;
    e.preventDefault();
    onDropPreset(payload, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  };

  return (
    <div
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-xl border border-line-2 bg-panel [zoom:calc(1/var(--hud-zoom,1))] [--xy-edge-stroke:hsl(var(--faint))] [--xy-controls-button-background-color:hsl(var(--card))] [--xy-controls-button-color:hsl(var(--foreground))]",
        className,
      )}
    >
      <div className="min-h-0 flex-1" onDragOver={onDragOver} onDrop={onDrop}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesDraggable={editable}
          nodesConnectable={editable}
          edgesFocusable={editable}
          elementsSelectable
          deleteKeyCode={editable ? ["Backspace", "Delete"] : null}
          selectionKeyCode={null}
          multiSelectionKeyCode={null}
          zoomOnDoubleClick={false}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          onNodeClick={(_, n) => onSelect?.(n.id)}
          onPaneClick={() => onSelect?.(null)}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
          minZoom={0.3}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}

export function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <Inner {...props} />
    </ReactFlowProvider>
  );
}
