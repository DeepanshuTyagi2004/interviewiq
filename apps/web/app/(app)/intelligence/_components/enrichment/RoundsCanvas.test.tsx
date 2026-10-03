import { useState, type ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactFlowProps, XYPosition } from "@xyflow/react";
import { newRound } from "@/features/research/enrichment";
import { RoundsCanvas } from "./RoundsCanvas";

let flowProps: ReactFlowProps;

vi.mock("@xyflow/react", () => ({
  Position: { Right: "right", Left: "left" },
  ReactFlowProvider: ({ children }: { children: ReactNode }) => children,
  Background: () => null,
  Controls: ({ showZoom, showFitView }: { showZoom: boolean; showFitView: boolean }) => <div aria-label="Diagram controls">
    {showZoom && <><button>Zoom in</button><button>Zoom out</button></>}
    {showFitView && <button>Fit view</button>}
  </div>,
  // This mock checks our interaction contract, not browser/React Flow wheel behavior.
  ReactFlow: (props: ReactFlowProps) => {
    flowProps = props;
    return <div data-testid="flow" onWheel={(event) => {
      if (props.preventScrolling || props.zoomOnScroll || props.panOnScroll) event.preventDefault();
    }}>{props.nodes?.map((node) => <button key={node.id} onClick={(event) => props.onNodeClick?.(event, node)}>{node.id}</button>)}{props.children}</div>;
  },
}));

const rounds = [{ ...newRound(), id: "round-1", name: "Coding" }, { ...newRound(), id: "round-2", name: "Design" }];
const defaultProps = { rounds, selectedId: "round-1", onSelect: vi.fn(), disabled: false };

beforeEach(() => vi.clearAllMocks());

describe("RoundsCanvas", () => {
  it("leaves compact wheel/touch scrolling to the editor and retains click selection", () => {
    const onWheel = vi.fn();
    const { container } = render(<div onWheel={onWheel}><RoundsCanvas {...defaultProps} /></div>);
    expect(flowProps).toMatchObject({
      zoomOnScroll: false, panOnScroll: false, preventScrolling: false,
      zoomOnPinch: false, zoomOnDoubleClick: false, zoomActivationKeyCode: null,
      panActivationKeyCode: null, panOnDrag: false, nodesDraggable: false,
      autoPanOnNodeFocus: false, selectionKeyCode: null,
    });
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 120 });
    fireEvent(screen.getByTestId("flow"), wheel);
    expect(wheel.defaultPrevented).toBe(false);
    expect(onWheel).toHaveBeenCalledOnce();
    expect(container.firstElementChild?.firstElementChild).toHaveClass("h-[340px]", "[&_.react-flow__pane]:!touch-auto");
    expect(screen.queryByLabelText("Diagram controls")).not.toBeInTheDocument();
    expect(screen.getByText(/Open fullscreen/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "round-2" }));
    expect(defaultProps.onSelect).toHaveBeenCalledWith("round-2");
  });

  it("enables fullscreen panning, pinch zoom, fit and zoom controls", () => {
    const { container } = render(<RoundsCanvas {...defaultProps} expanded />);
    expect(flowProps).toMatchObject({
      zoomOnScroll: false, panOnScroll: true, preventScrolling: true,
      zoomOnPinch: true, panOnDrag: true, nodesDraggable: true, elementsSelectable: true,
    });
    expect(container.firstElementChild).toHaveClass("h-full", "min-h-0");
    for (const name of ["Zoom in", "Zoom out", "Fit view"]) expect(screen.getByRole("button", { name })).toBeVisible();
    expect(screen.getByText(/Scroll or drag the background/)).toBeVisible();
  });

  it("keeps controlled positions and selection when the canvas remounts between modes", () => {
    function Harness() {
      const [expanded, setExpanded] = useState(true);
      const [positions, setPositions] = useState<Record<string, XYPosition>>({ "round-2": { x: 400, y: 90 } });
      const [selectedId, setSelectedId] = useState<string | null>("round-1");
      return <><button onClick={() => setExpanded(!expanded)}>Toggle mode</button><RoundsCanvas key={String(expanded)} {...defaultProps} expanded={expanded} positions={positions} onPositionsChange={setPositions} selectedId={selectedId} onSelect={setSelectedId} /></>;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "round-2" }));
    act(() => flowProps.onNodesChange?.([{ type: "position", id: "round-1", position: { x: 80, y: 160 }, dragging: true }]));
    fireEvent.click(screen.getByRole("button", { name: "Toggle mode" }));
    expect(flowProps.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "round-1", position: { x: 80, y: 160 }, selected: false }),
      expect.objectContaining({ id: "round-2", position: { x: 400, y: 90 }, selected: true }),
    ]));
    fireEvent.click(screen.getByRole("button", { name: "Toggle mode" }));
    expect(flowProps.nodes?.[0]?.position).toEqual({ x: 80, y: 160 });
    expect(flowProps.nodes?.[1]?.selected).toBe(true);
  });

  it("uses internal positions when uncontrolled", () => {
    render(<RoundsCanvas {...defaultProps} expanded />);
    act(() => flowProps.onNodesChange?.([{ type: "position", id: "round-1", position: { x: 50, y: 120 }, dragging: true }]));
    expect(flowProps.nodes?.[0]?.position).toEqual({ x: 50, y: 120 });
  });

  it.each([false, true])("blocks selection and position edits when disabled (expanded=%s)", (expanded) => {
    const onPositionsChange = vi.fn();
    render(<RoundsCanvas {...defaultProps} expanded={expanded} disabled onPositionsChange={onPositionsChange} />);
    expect(flowProps).toMatchObject({ nodesDraggable: false, nodesFocusable: false, elementsSelectable: false });
    fireEvent.click(screen.getByRole("button", { name: "round-2" }));
    act(() => flowProps.onNodesChange?.([{ type: "position", id: "round-1", position: { x: 50, y: 120 } }]));
    expect(defaultProps.onSelect).not.toHaveBeenCalled();
    expect(onPositionsChange).not.toHaveBeenCalled();
  });
});
