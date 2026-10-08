import { describe, expect, it } from "vitest";
import { blueprint } from "../fixtures";
import { blueprintToMarkdown } from "./markdown";

describe("blueprintToMarkdown", () => {
  const md = blueprintToMarkdown(blueprint);

  it("starts with the version and the candidate-visible briefing", () => {
    expect(md.startsWith("# Interview blueprint v2 (current)")).toBe(true);
    expect(md).toContain("## What the candidate sees");
    expect(md).toContain("- **Format:** 45-minute coding interview with a shared editor");
  });

  it("writes each slot's branch table as condition | action | say | notes", () => {
    expect(md).toContain("### core 1 · Two Sum");
    expect(md).toContain("| Condition | Action | Say | Notes |");
    expect(md).toContain("| stuck | give_hint | What would you need to know about each price? | first rung of the ladder |");
  });

  it("includes the hint ladder, the answer key with its verified solution, and the policies", () => {
    expect(md).toContain("1. Think about complements.");
    expect(md).toContain("verified against examples");
    expect(md).toContain("def two_sum(prices, budget):");
    expect(md).toContain("## Policies (policies-v1)");
    expect(md).toContain("| ask_solution | decline | Nudge with the next hint instead. |");
  });

  it("escapes pipes inside table cells", () => {
    const withPipe = {
      ...blueprint,
      slots: [{ ...blueprint.slots[0]!, branches: [{ condition: "stuck", action: "give_hint", say: "a | b" }] }],
    };
    expect(blueprintToMarkdown(withPipe)).toContain("| stuck | give_hint | a \\| b |  |");
  });
});
