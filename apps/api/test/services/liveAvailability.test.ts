import { describe, expect, it } from "vitest";
import { LiveAvailability } from "../../src/services/liveAvailability.js";
import { testConfig } from "../support/harness.js";

describe("LiveAvailability", () => {
  it("opens live interviews to everyone when the flag is on, else only to allowlisted users", () => {
    expect(new LiveAvailability(true).isAvailableFor("anyone")).toBe(true);
    const gated = new LiveAvailability(false, [" u1 ", "", "u2"]);
    expect(gated.isAvailableFor("u1")).toBe(true);
    expect(gated.isAvailableFor("u3")).toBe(false);
  });

  it("reads LIVE_INTERVIEWER_ALLOWLIST as comma-separated user ids", () => {
    expect(testConfig({ LIVE_INTERVIEWER_ALLOWLIST: "a, b,," }).blueprint.liveInterviewerAllowlist).toEqual(["a", "b"]);
    expect(testConfig().blueprint.liveInterviewerAllowlist).toEqual([]);
  });
});
