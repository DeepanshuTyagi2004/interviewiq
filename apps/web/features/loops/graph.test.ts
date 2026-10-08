import { describe, expect, it } from "vitest";
import { graphProblems, newCatalogueNode, newInfoNode, newPresetNode, newRoundNode, ROUND_PRESETS, wouldCreateCycle } from "./graph";
import { NODE_PRESETS } from "./presets";
import type { RoundType } from "@/features/interview";
import { isSlotTaken } from "./slots";
import type { ProcessGraph } from "./types";

const at = { x: 0, y: 0 };

describe("catalogue node creation", () => {
  it("keeps the five existing type defaults stable", () => {
    const defaults: [RoundType, string][] = [
      ["dsa", "coding"], ["system-design", "architecture"], ["lld", "object-design"],
      ["behavioural", "behavioural"], ["hiring-manager", "project"],
    ];
    for (const [type, id] of defaults) {
      const preset = ROUND_PRESETS.find((candidate) => candidate.id === id)!;
      expect(newRoundNode(type, at)).toMatchObject({
        kind: "round", type, name: preset.label, topics: preset.topics,
        durationMinutes: preset.durationMinutes, difficulty: preset.difficulty,
      });
    }
  });

  it("creates valid nodes for every catalogue preset without persisting catalogue metadata", () => {
    for (const preset of NODE_PRESETS) {
      const node = newCatalogueNode(preset.id, at);
      expect(node).toMatchObject({
        kind: preset.kind, name: preset.label, topics: preset.topics,
        difficulty: preset.difficulty, instructions: preset.instructions, position: at,
      });
      expect(node).not.toHaveProperty("category");
      expect(node).not.toHaveProperty("keywords");
      expect(node).not.toHaveProperty("description");
      if (node.kind === "round") {
        expect(graphProblems({ nodes: [node], edges: [] })).toEqual([]);
      } else {
        expect(node).toHaveProperty("note");
        expect(node.note.length).toBeLessThanOrEqual(1000);
        expect(node).not.toHaveProperty("type");
        expect(node).not.toHaveProperty("durationMinutes");
        expect(graphProblems({ nodes: [node], edges: [] })).toEqual(["Add at least one interview round."]);
        expect(graphProblems({ nodes: [newRoundNode("dsa", at), node], edges: [] })).toEqual([]);
      }
    }
  });

  it("clones topics and positions for both kinds, giving every node a unique ID", () => {
    for (const id of ["coding", "take-home"]) {
      const position = { x: 10, y: 20 };
      const preset = NODE_PRESETS.find((candidate) => candidate.id === id)!;
      const first = newCatalogueNode(id, position);
      const second = newCatalogueNode(id, position);
      expect(first.id).not.toBe(second.id);
      expect(first.topics).not.toBe(preset.topics);
      expect(first.topics).not.toBe(second.topics);
      expect(first.position).not.toBe(position);
      expect(first.position).not.toBe(second.position);
      first.topics!.push("User edit");
      first.position.x = 99;
      first.instructions = "User guidance";
      first.difficulty = "easy";
      expect(preset.topics).not.toContain("User edit");
      expect(second.topics).toEqual(preset.topics);
      expect(second.instructions).toBe(preset.instructions);
      expect(second.difficulty).toBe(preset.difficulty);
      expect(second.position).toEqual({ x: 10, y: 20 });
      expect(position).toEqual({ x: 10, y: 20 });
    }
    expect(newPresetNode("coding", at).position).not.toBe(at);
    expect(newRoundNode("dsa", at).position).not.toBe(at);
  });

  it("preserves the blank legacy info step", () => {
    expect(newInfoNode(at)).toMatchObject({ kind: "info", name: "Info step", note: "", position: at });
    expect(newInfoNode(at)).not.toHaveProperty("topics");
    expect(newInfoNode(at)).not.toHaveProperty("instructions");
    expect(newInfoNode(at)).not.toHaveProperty("difficulty");
    expect(newInfoNode(at).position).not.toBe(at);
  });

  it("rejects unknown and object-property IDs, info IDs in the round API, and unsupported types", () => {
    for (const id of ["", "unknown", "__proto__", "constructor", "toString"]) {
      expect(() => newCatalogueNode(id, at)).toThrow(/Unknown/);
      expect(() => newPresetNode(id, at)).toThrow(/Unknown/);
    }
    expect(() => newPresetNode("take-home", at)).toThrow(/Unknown/);
    expect(() => newRoundNode("unsupported" as RoundType, at)).toThrow(/Unsupported/);
  });
});

function chain(): ProcessGraph {
  const a = newRoundNode("dsa", at);
  const b = newRoundNode("system-design", at);
  return { nodes: [a, b], edges: [{ source: a.id, target: b.id }] };
}

describe("graphProblems", () => {
  it("offers distinct domain presets that all map to runnable types", () => {
    expect(ROUND_PRESETS.length).toBeGreaterThanOrEqual(12);
    expect(new Set(ROUND_PRESETS.map((preset) => preset.id)).size).toBe(ROUND_PRESETS.length);
    expect(new Set(ROUND_PRESETS.map((preset) => preset.label)).size).toBe(ROUND_PRESETS.length);
    for (const preset of ROUND_PRESETS) {
      const node = newPresetNode(preset.id, at);
      expect(["dsa", "system-design", "lld", "behavioural", "hiring-manager"]).toContain(node.type);
      expect(graphProblems({ nodes: [node], edges: [] })).toEqual([]);
    }
    expect(() => newPresetNode("unsupported", at)).toThrow();
  });

  it("rejects oversized topics and guidance without silently truncating them", () => {
    const round = newRoundNode("dsa", at);
    expect(graphProblems({ nodes: [{ ...round, topics: ["a".repeat(81)] }], edges: [] }).join(" ")).toMatch(/80 characters/);
    expect(graphProblems({ nodes: [{ ...round, topics: Array(21).fill("Topic") }], edges: [] }).join(" ")).toMatch(/20 topics/);
    expect(graphProblems({ nodes: [{ ...round, instructions: "a".repeat(4001) }], edges: [] }).join(" ")).toMatch(/4,000/);
  });
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
