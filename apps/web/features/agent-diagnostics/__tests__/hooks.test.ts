import { test, expect } from "vitest";
import { isSessionTerminal } from "../hooks";

test("awaiting_input is NOT terminal (keeps polling)", () => {
  expect(isSessionTerminal("awaiting_input")).toBe(false);
  expect(isSessionTerminal("running")).toBe(false);
});
test("terminal statuses stop polling", () => {
  for (const s of ["completed", "failed", "abandoned", "aborted"] as const) {
    expect(isSessionTerminal(s)).toBe(true);
  }
});
