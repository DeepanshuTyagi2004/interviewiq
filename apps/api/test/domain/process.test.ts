import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/lib/errors.js";
import { linearGraph, nodeStates, parseProcessGraph, progressOf, type ProcessGraph } from "../../src/domain/process.js";

const pos = { x: 0, y: 0 };
const round = (id: string, type = "dsa") => ({ id, kind: "round" as const, type, name: id, durationMinutes: 45, difficulty: "medium" as const, topics: [], position: pos });
const info = (id: string) => ({ id, kind: "info" as const, name: id, note: "", position: pos });
const g = (nodes: unknown[], edges: [string, string][]) => ({ nodes, edges: edges.map(([source, target]) => ({ source, target })) });
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof ApiError ? e.code : "other"; } return null; };

describe("parseProcessGraph", () => {
  it("accepts a chain and a diamond", () => {
    expect(code(() => parseProcessGraph(g([round("a"), round("b"), round("c")], [["a", "b"], ["b", "c"]])))).toBeNull();
    expect(code(() => parseProcessGraph(g([round("a"), round("b"), round("c"), round("d")], [["a", "b"], ["a", "c"], ["b", "d"], ["c", "d"]])))).toBeNull();
  });

  it("accepts a single round and info nodes without edges", () => {
    expect(code(() => parseProcessGraph(g([round("a"), info("oa")], [])))).toBeNull();
  });

  it("rejects no rounds, cycles, disconnected rounds, self loops and duplicate edges", () => {
    expect(code(() => parseProcessGraph(g([info("oa")], [])))).toBe("invalid_process");
    expect(code(() => parseProcessGraph(g([round("a"), round("b")], [["a", "b"], ["b", "a"]])))).toBe("invalid_process");
    expect(code(() => parseProcessGraph(g([round("a"), round("b")], [])))).toBe("invalid_process");
    expect(code(() => parseProcessGraph(g([round("a")], [["a", "a"]])))).toBe("invalid_process");
    expect(code(() => parseProcessGraph(g([round("a"), round("b")], [["a", "b"], ["a", "b"]])))).toBe("invalid_process");
  });

  it("never lets an info step carry an edge", () => {
    expect(code(() => parseProcessGraph(g([round("a"), info("oa")], [["oa", "a"]])))).toBe("invalid_process");
  });

  it("rejects duplicate ids, unknown edge ends and unknown round types", () => {
    expect(code(() => parseProcessGraph(g([round("a"), round("a")], [])))).toBe("invalid_process");
    expect(code(() => parseProcessGraph(g([round("a")], [["a", "zzz"]])))).toBe("invalid_process");
    expect(code(() => parseProcessGraph(g([round("a", "online-assessment")], [])))).toBe("invalid_process");
  });

  it("limits interview rounds to 12", () => {
    const ids = Array.from({ length: 13 }, (_, i) => `r${i}`);
    const edges = ids.slice(1).map((id, i) => [ids[i]!, id] as [string, string]);
    expect(code(() => parseProcessGraph(g(ids.map((i) => round(i)), edges)))).toBe("invalid_process");
  });
});

describe("loop node states (order-only gating)", () => {
  const diamond = parseProcessGraph(g([round("a"), round("b"), round("c"), round("d")], [["a", "b"], ["a", "c"], ["b", "d"], ["c", "d"]])) as ProcessGraph;
  const done = (nodeId: string) => ({ nodeId, status: "COMPLETED" });

  it("opens only roots at the start", () => {
    const s = nodeStates(diamond, []);
    expect([...s]).toEqual([["a", "available"], ["b", "locked"], ["c", "locked"], ["d", "locked"]]);
  });

  it("unlocks a join round only once every predecessor is completed", () => {
    expect(nodeStates(diamond, [done("a"), done("b")]).get("d")).toBe("locked");
    expect(nodeStates(diamond, [done("a"), done("b"), done("c")]).get("d")).toBe("available");
  });

  it("treats active sessions as booked and frees the round when cancelled or aborted", () => {
    expect(nodeStates(diamond, [{ nodeId: "a", status: "SCHEDULED" }]).get("a")).toBe("booked");
    expect(nodeStates(diamond, [{ nodeId: "a", status: "CANCELLED" }]).get("a")).toBe("available");
    expect(nodeStates(diamond, [{ nodeId: "a", status: "ABORTED_TECHNICAL" }]).get("a")).toBe("available");
  });

  it("counts only interview rounds in progress, ignoring info steps", () => {
    const withInfo = parseProcessGraph(g([round("a"), round("b"), info("oa")], [["a", "b"]])) as ProcessGraph;
    expect(progressOf(withInfo, [done("a")])).toEqual({ total: 2, completed: 1, nextNodeIds: ["b"] });
  });
});

describe("linearGraph", () => {
  it("chains interview rounds and turns info and unmapped rounds into unconnected info nodes", () => {
    const graph = linearGraph([
      { id: "oa", name: "Online assessment", type: "dsa", kind: "info", durationMinutes: 90, difficulty: "medium", topics: [] },
      { id: "r1", name: "Coding", type: "dsa", durationMinutes: 60, difficulty: "hard", topics: ["Graphs"] },
      { id: "r2", name: "Mystery", type: "weird", durationMinutes: 30, difficulty: null, topics: [] },
      { id: "r3", name: "Bar raiser", type: "behavioural", durationMinutes: 60, difficulty: "hard", topics: [] },
    ]);
    expect(graph.nodes.map((n) => `${n.kind}:${n.id}`)).toEqual(["info:oa", "round:r1", "info:r2", "round:r3"]);
    expect(graph.edges).toEqual([{ source: "r1", target: "r3" }]);
    expect(code(() => parseProcessGraph(graph))).toBeNull();
  });
});
