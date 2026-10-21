import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { NodeProps } from "@xyflow/react";
import type { NodeResult, RoundNode } from "../types";
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

  const node: RoundNode = {
    id: "a", kind: "round", name: "Coding", type: "dsa", durationMinutes: 45,
    difficulty: "medium", topics: [], position: { x: 0, y: 0 },
  };
  const renderState = (state: NonNullable<RoundFlowNode["data"]["state"]>, result?: NodeResult) => {
    const props = { data: { node, index: 0, editable: false, state, result }, selected: false } as unknown as NodeProps<RoundFlowNode>;
    render(<RoundFlowNodeView {...props} />);
  };
  const result = (over: Partial<NodeResult>): NodeResult => ({ sessionId: "s", score: null, passMark: null, outcome: null, retakeAfter: null, ...over });

  it("shows the score over the pass mark on a passed round", () => {
    renderState("passed", result({ score: 7.4, passMark: 7, outcome: "passed" }));
    expect(screen.getByText("Passed · 7.4 / 7.0")).toBeInTheDocument();
  });

  it("shows the retake date on a round in cooldown", () => {
    renderState("cooldown", result({ score: 6.2, passMark: 7, outcome: "below_pass", retakeAfter: "2026-10-25T09:00:00Z" }));
    expect(screen.getByText(/^Retake from \d{1,2} Oct$/)).toBeInTheDocument();
  });

  it("shows Grading while the round is evaluated", () => {
    renderState("evaluating");
    expect(screen.getByText("Grading")).toBeInTheDocument();
  });

  it("calls a legacy completed round not scored", () => {
    renderState("completed");
    expect(screen.getByText("Completed · Not scored")).toBeInTheDocument();
  });
});
