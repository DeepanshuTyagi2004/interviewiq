import { useState, type ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Node, ReactFlowProps } from "@xyflow/react";
import type { ProcessGraph, RoundNode } from "../types";
import { FlowCanvas, PALETTE_MIME } from "./FlowCanvas";

const flow = vi.hoisted(() => ({
  props: null as ReactFlowProps<Node> | null,
  fitView: vi.fn(),
  screenToFlowPosition: vi.fn(),
  initialized: true,
}));

// Exercise the controlled-state boundary using the installed applyNodeChanges.
// Layout/pointer correctness requires a real browser; this mock does not prove it.
vi.mock("@xyflow/react", async (importOriginal) => ({
  ...await importOriginal<typeof import("@xyflow/react")>(),
  ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
  ReactFlow: (props: ReactFlowProps<Node>) => {
    flow.props = props;
    return <div data-testid="react-flow" className={props.className} style={props.style} />;
  },
  Background: () => null,
  Controls: () => null,
  useReactFlow: () => ({ fitView: flow.fitView, screenToFlowPosition: flow.screenToFlowPosition }),
  useNodesInitialized: () => flow.initialized,
}));

const round = (id: string, x: number): RoundNode => ({
  id, kind: "round", name: id, type: "dsa", durationMinutes: 60,
  difficulty: "medium", topics: [], position: { x, y: 0 },
});
const initial = (): ProcessGraph => ({
  // Deliberately reverse stored array order: the edge, not x, determines the sequence.
  nodes: [round("b", 300), round("a", 0)], edges: [{ source: "a", target: "b" }],
});
const props = () => flow.props!;
const node = (id: string) => props().nodes!.find((n) => n.id === id)!;

function Editor({ onSave }: { onSave: (graph: ProcessGraph) => void }) {
  const [graph, setGraph] = useState(initial);
  const [selected, setSelected] = useState<string | null>(null);
  return <>
    <button onClick={() => setGraph((g) => ({ ...g, nodes: g.nodes.map((n) => n.id === "a" ? { ...n, name: "Inspector edit" } : n) }))}>Patch name</button>
    <button onClick={() => onSave(graph)}>Save</button>
    <FlowCanvas graph={graph} mode="edit" selectedId={selected} onSelect={setSelected} onGraphChange={setGraph} />
  </>;
}

function PaletteEditor({ reject = false }: { reject?: boolean }) {
  const [graph, setGraph] = useState(initial);
  return <>
    <button onClick={() => setGraph((graph) => ({ ...graph, nodes: [...graph.nodes, round("click-added", 42)] }))}>Click-add</button>
    <FlowCanvas graph={graph} mode="edit" onDropPreset={(_, position) => {
      if (!reject) setGraph((graph) => ({ ...graph, nodes: [...graph.nodes, { ...round("dropped", 0), position }] }));
    }} />
  </>;
}

function dragEvent(type: "drop" | "dragover", payload = "catalogue:javascript", types = [PALETTE_MIME]) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { clientX: 321, clientY: 234, dataTransfer: { types, getData: vi.fn((type) => type === PALETTE_MIME ? payload : ""), dropEffect: "none" } });
  return event;
}

beforeEach(() => {
  vi.useFakeTimers();
  flow.initialized = true;
  flow.fitView.mockReset();
  flow.screenToFlowPosition.mockReset().mockReturnValue({ x: 42, y: 99 });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("FlowCanvas controlled interactions", () => {
  it("persists all rapid batched position and edge events in the parent's saved graph", () => {
    const save = vi.fn();
    render(<Editor onSave={save} />);
    const handlers = props();
    act(() => {
      handlers.onNodesChange!([{ id: "a", type: "position", position: { x: 30, y: 40 }, dragging: true }]);
      handlers.onNodesChange!([{ id: "b", type: "position", position: { x: 80, y: 90 }, dragging: true }]);
      handlers.onNodesChange!([{ id: "a", type: "position", position: { x: 120, y: 130 }, dragging: false }]);
      handlers.onEdgesChange!([{ id: "a>b", type: "remove" }]);
      handlers.onConnect!({ source: "b", target: "a", sourceHandle: null, targetHandle: null });
    });
    fireEvent.click(screen.getByText("Save"));
    const saved = save.mock.calls[0]![0] as ProcessGraph;
    expect(saved.nodes.find((n) => n.id === "a")!.position).toEqual({ x: 120, y: 130 });
    expect(saved.nodes.find((n) => n.id === "b")!.position).toEqual({ x: 80, y: 90 });
    expect(saved.edges).toEqual([{ source: "b", target: "a" }]);
  });

  it("keeps topology numbering and inspector edits when a round crosses another during drag", () => {
    const save = vi.fn();
    render(<Editor onSave={save} />);
    expect(node("a").data.index).toBe(0);
    expect(node("b").data.index).toBe(1);
    act(() => props().onNodesChange!([{ id: "a", type: "position", position: { x: 700, y: 20 }, dragging: true }]));
    fireEvent.click(screen.getByText("Patch name"));
    act(() => props().onNodesChange!([{ id: "a", type: "position", position: { x: 750, y: 30 }, dragging: false }]));
    expect(node("a").data.index).toBe(0);
    expect(node("b").data.index).toBe(1);
    fireEvent.click(screen.getByText("Save"));
    const saved = save.mock.calls[0]![0] as ProcessGraph;
    expect(saved.nodes.find((n) => n.id === "a")).toMatchObject({ name: "Inspector edit", position: { x: 750, y: 30 } });
    expect(saved.edges).toEqual(initial().edges);
    act(() => vi.runAllTimers());
    expect(flow.fitView).not.toHaveBeenCalled();
  });

  it("retains measured dimensions and dragging through selection-only rerenders", () => {
    const graph = initial();
    const change = vi.fn();
    const { rerender } = render(<FlowCanvas graph={graph} mode="edit" onGraphChange={change} />);
    act(() => {
      props().onNodesChange!([{ id: "a", type: "dimensions", dimensions: { width: 230, height: 142 } }]);
      props().onNodesChange!([{ id: "a", type: "position", position: { x: 600, y: 70 }, dragging: true }]);
      props().onNodesChange!([{ id: "a", type: "select", selected: true }]);
    });
    expect(change).toHaveBeenCalledTimes(1); // dimensions and selection are not domain edits
    rerender(<FlowCanvas graph={graph} mode="edit" selectedId="a" onGraphChange={change} />);
    expect(node("a")).toMatchObject({ position: { x: 600, y: 70 }, measured: { width: 230, height: 142 }, dragging: true, selected: true });
    act(() => props().onNodesChange!([{ id: "b", type: "position", position: { x: 400, y: 80 }, dragging: false }]));
    expect(change.mock.lastCall![0].nodes.find((n: RoundNode) => n.id === "a").position).toEqual({ x: 600, y: 70 });
  });

  it("initializes read-only dimensions without publishing and retains booking state", () => {
    const book = vi.fn();
    const change = vi.fn();
    render(<FlowCanvas graph={initial()} mode="view" nodeStates={{ a: "available", b: "locked" }} onBookNode={book} onGraphChange={change} />);
    act(() => props().onNodesChange!([{ id: "a", type: "dimensions", dimensions: { width: 230, height: 190 } }]));
    expect(node("a").measured).toEqual({ width: 230, height: 190 });
    expect(node("a").data).toMatchObject({ state: "available", editable: false, onBook: book });
    expect(node("b").data.state).toBe("locked");
    expect(props().nodesDraggable).toBe(false);
    expect(props().deleteKeyCode).toBeNull();
    expect(change).not.toHaveBeenCalled();
  });

  it("removes incident edges without discarding another same-batch node move", () => {
    const change = vi.fn();
    render(<FlowCanvas graph={initial()} mode="edit" onGraphChange={change} />);
    const handlers = props();
    act(() => {
      handlers.onNodesChange!([{ id: "b", type: "position", position: { x: 500, y: 20 } }]);
      handlers.onNodesChange!([{ id: "a", type: "remove" }]);
    });
    expect(change.mock.lastCall![0]).toEqual({ nodes: [{ ...round("b", 500), position: { x: 500, y: 20 } }], edges: [] });
  });
});

describe("FlowCanvas fit and input boundaries", () => {
  it("fits only count changes, waits for measurements, and defers fitting until dragging ends", () => {
    const graph = initial();
    const change = vi.fn();
    const { rerender } = render(<FlowCanvas graph={graph} mode="edit" onGraphChange={change} />);
    act(() => props().onNodesChange!([{ id: "a", type: "position", position: { x: 100, y: 40 }, dragging: true }]));
    const added = { ...graph, nodes: [...graph.nodes, round("c", 600)] };
    flow.initialized = false;
    rerender(<FlowCanvas graph={added} mode="edit" onGraphChange={change} />);
    act(() => vi.runAllTimers());
    expect(flow.fitView).not.toHaveBeenCalled();
    flow.initialized = true;
    rerender(<FlowCanvas graph={added} mode="edit" selectedId="a" onGraphChange={change} />);
    act(() => vi.runAllTimers());
    expect(flow.fitView).not.toHaveBeenCalled();
    act(() => props().onNodesChange!([{ id: "a", type: "position", position: { x: 100, y: 40 }, dragging: false }]));
    act(() => vi.runAllTimers());
    expect(flow.fitView).toHaveBeenCalledTimes(1);
    rerender(<FlowCanvas graph={added} mode="edit" selectedId="b" onGraphChange={change} />);
    act(() => vi.runAllTimers());
    expect(flow.fitView).toHaveBeenCalledTimes(1);
    rerender(<FlowCanvas graph={graph} mode="edit" onGraphChange={change} />);
    act(() => vi.runAllTimers());
    expect(flow.fitView).toHaveBeenCalledTimes(2);
  });

  it.each(["input", "textarea", "select", "contenteditable", "combobox", "listbox"])("blocks React Flow deletion while %s is focused", async (kind) => {
    render(<>
      {kind === "contenteditable" ? <div contentEditable suppressContentEditableWarning tabIndex={0} data-testid="field"><span tabIndex={0} data-testid="nested-field" /></div>
        : kind === "input" ? <input data-testid="field" />
        : kind === "textarea" ? <textarea data-testid="field" />
        : kind === "combobox" ? <><button role="combobox" aria-label="Difficulty" aria-expanded={false} aria-controls="difficulty-options" data-testid="field">Medium</button><div id="difficulty-options" role="listbox" aria-label="Difficulty options" hidden /></>
        : kind === "listbox" ? <div role="listbox" aria-label="Difficulty choices" tabIndex={0} data-testid="field" />
        : <select data-testid="field"><option>Medium</option></select>}
      <FlowCanvas graph={initial()} mode="edit" />
    </>);
    screen.getByTestId(kind === "contenteditable" ? "nested-field" : "field").focus();
    expect(await props().onBeforeDelete!({ nodes: [node("a")], edges: [] })).toBe(false);
    (document.activeElement as HTMLElement).blur();
    expect(await props().onBeforeDelete!({ nodes: [node("a")], edges: [] })).toBe(true);
  });

  it("uses screenToFlowPosition directly for palette drops and gives the viewport a sizing context", () => {
    const drop = vi.fn();
    render(<FlowCanvas graph={initial()} mode="edit" onDropPreset={drop} />);
    const canvas = screen.getByTestId("react-flow");
    const dropEvent = dragEvent("drop", "round:dsa");
    fireEvent(canvas, dropEvent);
    expect(flow.screenToFlowPosition).toHaveBeenCalledWith({ x: 321, y: 234 });
    expect(drop).toHaveBeenCalledWith("round:dsa", { x: 42, y: 99 });
    expect(canvas.parentElement).toHaveClass("relative", "flex-1", "min-h-[280px]");
    expect(canvas).toHaveClass("!absolute", "inset-0", "!h-auto");
    expect(canvas.parentElement!.parentElement).toHaveClass("min-h-[280px]", "[zoom:calc(1/var(--hud-zoom,1))]");
  });

  it("preserves the viewport after a real drop insertion, including delayed measurements, then fits a click-add", async () => {
    const { rerender } = render(<PaletteEditor />);
    flow.initialized = false;
    fireEvent(screen.getByTestId("react-flow"), dragEvent("drop"));
    expect(node("dropped").position).toEqual({ x: 42, y: 99 });
    await act(async () => { await Promise.resolve(); });
    act(() => vi.runAllTimers());
    flow.initialized = true;
    rerender(<PaletteEditor />);
    act(() => vi.runAllTimers());
    expect(flow.fitView).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Click-add"));
    act(() => vi.runAllTimers());
    expect(flow.fitView).toHaveBeenCalledTimes(1);
  });

  it("does not let a rejected drop suppress a later click-add fit at the same position", async () => {
    render(<PaletteEditor reject />);
    fireEvent(screen.getByTestId("react-flow"), dragEvent("drop"));
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByText("Click-add"));
    act(() => vi.runAllTimers());
    expect(flow.fitView).toHaveBeenCalledTimes(1);
  });

  it("accepts palette drops once inside a node and stops bubbling them to an outer drop zone", () => {
    const outer = vi.fn();
    const drop = vi.fn();
    render(<div onDrop={outer}><FlowCanvas graph={initial()} mode="edit" onDropPreset={drop} /></div>);
    const event = dragEvent("drop");
    fireEvent(screen.getByTestId("react-flow"), event);
    expect(event.defaultPrevented).toBe(true);
    expect(drop).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it.each([
    { type: "drop" as const, payload: "catalogue:javascript", types: ["text/plain"] },
    { type: "dragover" as const, payload: "catalogue:javascript", types: ["Files"] },
    { type: "drop" as const, payload: "garbage", types: [PALETTE_MIME] },
    { type: "drop" as const, payload: "catalogue:", types: [PALETTE_MIME] },
  ])("does not hijack unsupported transfers: $type $payload $types", ({ type, payload, types }) => {
    const drop = vi.fn();
    const outer = vi.fn();
    render(<div onDrop={outer} onDragOver={outer}><FlowCanvas graph={initial()} mode="edit" onDropPreset={drop} /></div>);
    const event = dragEvent(type, payload, types);
    fireEvent(screen.getByTestId("react-flow"), event);
    expect(event.defaultPrevented).toBe(false);
    expect(drop).not.toHaveBeenCalled();
    expect(outer).toHaveBeenCalledTimes(1);
  });
});
