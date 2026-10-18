import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { NodeProps } from "@xyflow/react";
import type { RoundNode } from "../types";
import { RoundFlowNodeView, type RoundFlowNode } from "./FlowNodes";

// Handles need a live React Flow canvas; they are not what is under test.
vi.mock("@xyflow/react", async (importOriginal) => ({
  ...await importOriginal<typeof import("@xyflow/react")>(),
  Handle: () => null,
}));

describe("RoundFlowNodeView", () => {
  it("shows the 30-45 min label, even for a saved round that still holds 60", () => {
    const node: RoundNode = {
      id: "a", kind: "round", name: "Coding", type: "dsa", durationMinutes: 60,
      difficulty: "medium", topics: [], position: { x: 0, y: 0 },
    };
    // NodeProps carries many React Flow fields this view never reads.
    const props = { data: { node, index: 0, editable: false }, selected: false } as unknown as NodeProps<RoundFlowNode>;
    render(<RoundFlowNodeView {...props} />);
    expect(screen.getByText("DSA · 30-45 min · medium")).toBeInTheDocument();
    expect(screen.queryByText(/60 min/)).toBeNull();
  });
});
