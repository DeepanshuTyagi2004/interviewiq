import { describe, it, expect } from "vitest";
import { OTHER_COLOR, SHARE_SLOTS, foldShares, formatPct } from "./shares";

const langs = (pairs: [string, number][]) => pairs.map(([name, pct]) => ({ name, pct }));

describe("foldShares", () => {
  it("sorts largest first and gives each kept item its fixed slot colour", () => {
    const out = foldShares(langs([["Go", 20], ["TypeScript", 50], ["Python", 30]]), (l) => l.name, (l) => l.pct);
    expect(out.map((s) => s.name)).toEqual(["TypeScript", "Python", "Go"]);
    expect(out.map((s) => s.color)).toEqual([SHARE_SLOTS[0], SHARE_SLOTS[1], SHARE_SLOTS[2]]);
  });

  it("folds everything past the slot count into a neutral Other", () => {
    const out = foldShares(
      langs([["A", 30], ["B", 25], ["C", 15], ["D", 10], ["E", 8], ["F", 7], ["G", 5]]),
      (l) => l.name,
      (l) => l.pct,
    );
    expect(out).toHaveLength(6);
    expect(out[5]).toEqual({ name: "Other", value: 12, color: OTHER_COLOR, other: true });
  });

  it("keeps a single leftover's own name but still greys it", () => {
    const out = foldShares(langs([["A", 1], ["B", 1], ["C", 1], ["D", 1], ["E", 1], ["F", 1]]), (l) => l.name, (l) => l.pct);
    expect(out[5]).toMatchObject({ name: "F", color: OTHER_COLOR, other: true });
  });

  it("never cycles colours, even when asked for more slots than exist", () => {
    const many = langs(Array.from({ length: 9 }, (_, i) => [`L${i}`, 9 - i] as [string, number]));
    const out = foldShares(many, (l) => l.name, (l) => l.pct, 20);
    expect(out.filter((s) => !s.other)).toHaveLength(SHARE_SLOTS.length);
  });

  it("drops zero values", () => {
    expect(foldShares(langs([["A", 0], ["B", 3]]), (l) => l.name, (l) => l.pct).map((s) => s.name)).toEqual(["B"]);
  });
});

describe("formatPct", () => {
  it("formats shares compactly without ever showing 0% for a real share", () => {
    expect(formatPct(48.4)).toBe("48%");
    expect(formatPct(4.54)).toBe("4.5%");
    expect(formatPct(0.3)).toBe("<1%");
    expect(formatPct(0)).toBe("0%");
  });
});
