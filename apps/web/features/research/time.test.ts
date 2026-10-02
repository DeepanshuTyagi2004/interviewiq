import { describe, expect, it } from "vitest";
import { timeAgo } from "./time";

const NOW = Date.parse("2026-10-02T12:00:00Z");

describe("timeAgo", () => {
  it.each([
    ["2026-10-02T11:59:40Z", "just now"],
    ["2026-10-02T11:55:00Z", "5m ago"],
    ["2026-10-02T09:00:00Z", "3h ago"],
    ["2026-09-30T12:00:00Z", "2d ago"],
    ["2026-08-01T12:00:00Z", "1 Aug 2026"],
  ])("%s → %s", (iso, expected) => {
    expect(timeAgo(iso, NOW)).toBe(expected);
  });
});
