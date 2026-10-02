import { describe, expect, it } from "vitest";
import { SOURCE_DOT_LABEL, sourceDotState } from "./sourceDotState";

describe("sourceDotState", () => {
  it.each([
    [{ connected: false, syncing: false, error: false }, "idle"],
    [{ connected: true, syncing: false, error: false }, "active"],
    [{ connected: true, syncing: true, error: false }, "live"],
    [{ connected: true, syncing: false, error: true }, "error"],
  ] as const)("%o → %s", (input, expected) => {
    expect(sourceDotState(input)).toBe(expected);
  });

  it("puts an error ahead of a sync, and a sync ahead of connected", () => {
    expect(sourceDotState({ connected: true, syncing: true, error: true })).toBe("error");
    expect(sourceDotState({ connected: false, syncing: false, error: true })).toBe("error");
    expect(sourceDotState({ connected: false, syncing: true, error: false })).toBe("live");
  });

  it("has screen-reader text for every state it returns", () => {
    expect(SOURCE_DOT_LABEL).toEqual({
      active: "Connected",
      live: "Syncing",
      error: "Sync error",
      idle: "Not connected",
    });
  });
});
