import { describe, expect, it } from "vitest";
import { graphProblems, newInfoNode, newRoundNode, wouldCreateCycle } from "./graph";
import { isSlotTaken } from "./slots";
import type { ProcessGraph } from "./types";

const at = { x: 0, y: 0 };

function chain(): ProcessGraph {
  const a = newRoundNode("dsa", at);
  const b = newRoundNode("system-design", at);
  return { nodes: [a, b], edges: [{ source: a.id, target: b.id }] };
}

describe("graphProblems", () => {
  it("is empty for a valid chain", () => {
    expect(graphProblems(chain())).toEqual([]);
  });

  it("asks for at least one interview round, and info steps alone don't count", () => {
    expect(graphProblems({ nodes: [], edges: [] })).toContain("Add at least one interview round.");
    expect(graphProblems({ nodes: [newInfoNode(at)], edges: [] })).toContain("Add at least one interview round.");
  });

  it("flags disconnected rounds and cycles", () => {
    const g = chain();
    expect(graphProblems({ ...g, edges: [] }).join(" ")).toMatch(/connected/);
    const [a, b] = g.nodes;
    expect(graphProblems({ ...g, edges: [{ source: a!.id, target: b!.id }, { source: b!.id, target: a!.id }] }).join(" ")).toMatch(/loop/);
  });
});

describe("wouldCreateCycle", () => {
  it("refuses back edges and self edges but allows forward edges", () => {
    const g = chain();
    const [a, b] = g.nodes;
    expect(wouldCreateCycle(g, b!.id, a!.id)).toBe(true);
    expect(wouldCreateCycle(g, a!.id, a!.id)).toBe(true);
    const c = newRoundNode("lld", at);
    expect(wouldCreateCycle({ ...g, nodes: [...g.nodes, c] }, a!.id, c.id)).toBe(false);
  });
});

describe("isSlotTaken", () => {
  const base = new Date("2030-01-10T10:00:00.000Z");
  const session = (iso: string, status = "SCHEDULED") => ({ id: iso, status: status as never, scheduledAt: iso });

  it("treats anything within an hour as a clash", () => {
    expect(isSlotTaken(base, [session("2030-01-10T10:30:00.000Z")])).toBe(true);
    expect(isSlotTaken(base, [session("2030-01-10T09:30:00.000Z")])).toBe(true);
    expect(isSlotTaken(base, [session("2030-01-10T11:00:00.000Z")])).toBe(false);
  });

  it("ignores cancelled and interrupted interviews, and the session being moved", () => {
    expect(isSlotTaken(base, [session("2030-01-10T10:00:00.000Z", "CANCELLED")])).toBe(false);
    expect(isSlotTaken(base, [session("2030-01-10T10:00:00.000Z", "ABORTED_TECHNICAL")])).toBe(false);
    expect(isSlotTaken(base, [session("2030-01-10T10:00:00.000Z")], "2030-01-10T10:00:00.000Z")).toBe(false);
  });
});
