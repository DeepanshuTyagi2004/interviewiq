"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  applyNodeChanges,
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
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

function isPaletteTransfer(transfer: DataTransfer): boolean {
  return Array.from(transfer.types ?? []).includes(PALETTE_MIME);
}

function isPalettePayload(payload: string): boolean {
  return payload === "info" || /^(catalogue|preset|round):[a-z][a-z0-9_-]*$/i.test(payload);
}

const nodeTypes = { round: RoundFlowNodeView, info: InfoFlowNodeView };

/** Keep measurements and in-flight interaction state when inspector/selection props change. */
function reconcileNodes(source: Node[], current: Node[]): Node[] {
  const byId = new Map(current.map((node) => [node.id, node]));
  return source.map((node) => {
    const previous = byId.get(node.id);
    return previous
      ? { ...previous, ...node, position: previous.dragging ? previous.position : node.position }
      : node;
  });
}

function editingFieldFocused(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLElement && (
    !!active.closest('input, textarea, select, [role="combobox"], [role="listbox"], [role="option"]') || active.isContentEditable ||
    !!active.closest('[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]')
  );
}

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
  const nodesInitialized = useNodesInitialized();
  // Events can arrive several times before React commits the parent's next graph.
  const latestGraph = useRef(graph);
  const draggingIds = useRef(new Set<string>());
  const prevCount = useRef(graph.nodes.length);
  const pendingDrop = useRef<{ ids: Set<string>; position: { x: number; y: number } } | null>(null);
  useLayoutEffect(() => {
    latestGraph.current = graph;
    const ids = new Set(graph.nodes.map((node) => node.id));
    for (const id of draggingIds.current) if (!ids.has(id)) draggingIds.current.delete(id);
    const drop = pendingDrop.current;
    if (drop && graph.nodes.some((node) => !drop.ids.has(node.id) &&
      node.position.x === drop.position.x && node.position.y === drop.position.y)) {
      // Acknowledge the inserted node before asynchronous measurements can
      // trigger auto-fit. The persisted drop position already accounts for pan/zoom.
      prevCount.current = graph.nodes.length;
      pendingDrop.current = null;
    }
  }, [graph]);
  const publish = useCallback((next: ProcessGraph) => {
    latestGraph.current = next;
    onGraphChange?.(next);
  }, [onGraphChange]);

  const roundIndex = useMemo(() => {
    const rounds = graph.nodes.filter(isRound);
    const remaining = new Set(rounds.map((node) => node.id));
    const indegree = new Map(rounds.map((node) => [node.id, 0]));
    for (const edge of graph.edges) {
      if (remaining.has(edge.source) && remaining.has(edge.target)) {
        indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
      }
    }
    const ordered = [];
    // Topological order, with stored array order as a stable tie-breaker. Moving a
    // card must never change which interview is Round 01. Tolerate invalid drafts.
    while (remaining.size) {
      const node = rounds.find((n) => remaining.has(n.id) && indegree.get(n.id) === 0)
        ?? rounds.find((n) => remaining.has(n.id))!;
      ordered.push(node);
      remaining.delete(node.id);
      for (const edge of graph.edges) if (edge.source === node.id) {
        indegree.set(edge.target, (indegree.get(edge.target) ?? 0) - 1);
      }
    }
    return new Map(ordered.map((n, i) => [n.id, i]));
  }, [graph.nodes, graph.edges]);

  const sourceNodes = useMemo<Node[]>(
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

  // Domain graphs deliberately omit React Flow's measured/dragging/selection
  // fields. Apply every flow change locally, and only persist domain changes.
  const [nodeState, setNodeState] = useState(() => ({ source: sourceNodes, nodes: sourceNodes }));
  let nodes = nodeState.nodes;
  if (nodeState.source !== sourceNodes) {
    nodes = reconcileNodes(sourceNodes, nodeState.nodes);
    setNodeState({ source: sourceNodes, nodes });
  }
  const dragging = nodes.some((node) => node.dragging);
  const count = graph.nodes.length;
  useEffect(() => {
    if (dragging || !nodesInitialized || prevCount.current === count) return;
    const id = requestAnimationFrame(() => {
      if (draggingIds.current.size) return;
      prevCount.current = count;
      // An animated auto-fit can still be moving when the next drag starts.
      void fitView({ padding: 0.2, maxZoom: 1 });
    });
    return () => cancelAnimationFrame(id);
  }, [count, dragging, nodesInitialized, fitView]);

  const edges = useMemo<Edge[]>(
    () => graph.edges.map((e) => ({
      id: `${e.source}>${e.target}`, source: e.source, target: e.target, type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed }, deletable: editable, selectable: editable,
    })),
    [graph.edges, editable],
  );

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodeState((current) => ({ ...current, nodes: applyNodeChanges(changes, current.nodes) }));
    for (const change of changes) {
      if (change.type === "position" && change.dragging !== undefined) {
        if (change.dragging) draggingIds.current.add(change.id);
        else draggingIds.current.delete(change.id);
      } else if (change.type === "remove") draggingIds.current.delete(change.id);
    }
    if (!editable || !onGraphChange) return;
    const graph = latestGraph.current;
    let next = graph;
    for (const c of changes) {
      if (c.type === "position" && c.position) {
        const pos = c.position;
        next = { ...next, nodes: next.nodes.map((n) => (n.id === c.id ? { ...n, position: pos } : n)) };
      } else if (c.type === "remove") {
        next = {
          ...next,
          nodes: next.nodes.filter((n) => n.id !== c.id),
          edges: next.edges.filter((e) => e.source !== c.id && e.target !== c.id),
        };
      }
    }
    if (next !== graph) publish(next);
  }, [editable, onGraphChange, publish]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (!editable || !onGraphChange) return;
    const removed = new Set(changes.filter((c) => c.type === "remove").map((c) => c.id));
    if (removed.size === 0) return;
    const graph = latestGraph.current;
    publish({ ...graph, edges: graph.edges.filter((e) => !removed.has(`${e.source}>${e.target}`)) });
  }, [editable, onGraphChange, publish]);

  const onConnect = useCallback((c: Connection) => {
    if (!editable || !onGraphChange || !c.source || !c.target) return;
    const graph = latestGraph.current;
    if (!graph.nodes.some((n) => n.id === c.source && isRound(n)) || !graph.nodes.some((n) => n.id === c.target && isRound(n))) return;
    if (graph.edges.some((e) => e.source === c.source && e.target === c.target)) return;
    if (wouldCreateCycle(graph, c.source, c.target)) return;
    publish({ ...graph, edges: [...graph.edges, { source: c.source, target: c.target }] });
  }, [editable, onGraphChange, publish]);

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      const graph = latestGraph.current;
      return !!c.source && !!c.target &&
        graph.nodes.some((n) => n.id === c.source && isRound(n)) &&
        graph.nodes.some((n) => n.id === c.target && isRound(n)) &&
        !wouldCreateCycle(graph, c.source, c.target);
    },
    [],
  );

  const onBeforeDelete = useCallback(async () => !editingFieldFocused(), []);

  const onDragOver = (e: DragEvent) => {
    if (!editable || !onDropPreset || !isPaletteTransfer(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDrop = (e: DragEvent) => {
    if (!editable || !onDropPreset || !isPaletteTransfer(e.dataTransfer)) return;
    const payload = e.dataTransfer.getData(PALETTE_MIME);
    if (!isPalettePayload(payload)) return;
    e.preventDefault();
    e.stopPropagation();
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const drop = { ids: new Set(latestGraph.current.nodes.map((node) => node.id)), position };
    pendingDrop.current = drop;
    // The editor inserts synchronously; only that graph commit may consume this
    // marker. A rejected/capped drop must not suppress a later click-add fit.
    onDropPreset(payload, position);
    queueMicrotask(() => {
      if (pendingDrop.current === drop) pendingDrop.current = null;
    });
  };

  return (
    <div
      className={cn(
        // Neutralize the page's CSS zoom, not React Flow's viewport transform.
        // HudZoomOff already sets --hud-zoom=1 in the editor, so this is neutral there.
        "flex min-h-[280px] min-w-0 w-full flex-col overflow-hidden rounded-xl border border-line-2 bg-panel [zoom:calc(1/var(--hud-zoom,1))] [--xy-edge-stroke:hsl(var(--faint))] [--xy-controls-button-background-color:hsl(var(--card))] [--xy-controls-button-color:hsl(var(--foreground))]",
        className,
      )}
    >
      <div className="relative min-h-[280px] w-full flex-1" onDragOver={onDragOver} onDrop={onDrop}>
        <ReactFlow
          // The installed React Flow forces inline relative/height:100% even
          // over its style prop. Percent height collapses in an intrinsic flex
          // parent; override those defaults and fill the measured box by inset.
          className="!absolute inset-0 !h-auto"
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
          onBeforeDelete={onBeforeDelete}
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
