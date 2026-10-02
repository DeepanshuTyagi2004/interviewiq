import { describe, expect, it } from "vitest";
import { continueList, isOnListLine, shiftIndent, toggleList, toggleWrap } from "./highlights-format";

describe("toggleWrap", () => {
  it("bolds a selection, keeping spaces outside the markers", () => {
    const value = "Cut latency by 42% overall";
    const s = value.indexOf("42% ");
    expect(toggleWrap(value, s, s + 4, "**").value).toBe("Cut latency by **42%** overall");
  });

  it("unbolds an already-bold selection (inner or including the markers)", () => {
    const v = "by **42%** overall";
    const inner = v.indexOf("42%");
    expect(toggleWrap(v, inner, inner + 3, "**").value).toBe("by 42% overall");
    const outer = v.indexOf("**");
    expect(toggleWrap(v, outer, outer + 7, "**").value).toBe("by 42% overall");
  });

  it("inserts an empty pair with the caret inside when nothing is selected", () => {
    expect(toggleWrap("ab", 1, 1, "**")).toEqual({ value: "a****b", start: 3, end: 3 });
  });
});

describe("toggleList", () => {
  it("bullets plain lines and un-bullets them again", () => {
    const v = "One\nTwo";
    const on = toggleList(v, 0, v.length, "bullet");
    expect(on.value).toBe("- One\n- Two");
    expect(toggleList(on.value, 0, on.value.length, "bullet").value).toBe("One\nTwo");
  });

  it("numbers lines, converting bullets and keeping indentation", () => {
    const v = "- One\n  - Two";
    expect(toggleList(v, 0, v.length, "number").value).toBe("1. One\n  2. Two");
  });
});

describe("shiftIndent", () => {
  it("nests and un-nests lines by two spaces", () => {
    expect(shiftIndent("- a\n- b", 0, 7, 1).value).toBe("  - a\n  - b");
    expect(shiftIndent("  - a", 0, 5, -1).value).toBe("- a");
  });
});

describe("continueList / isOnListLine", () => {
  it("continues bullets and numbered points with the same indent", () => {
    expect(continueList("  - one", 7)?.value).toBe("  - one\n  - ");
    expect(continueList("1. one", 6)?.value).toBe("1. one\n2. ");
  });

  it("ends the list on an empty item and ignores plain lines", () => {
    expect(continueList("- a\n- ", 6)?.value).toBe("- a\n");
    expect(continueList("plain", 5)).toBeNull();
    expect(isOnListLine("plain\n- item", 9)).toBe(true);
    expect(isOnListLine("plain\n- item", 2)).toBe(false);
  });
});
