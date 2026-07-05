import { describe, expect, it } from "vitest";
import { initialMachine, transition, type LiveState } from "./machine";

function at(state: LiveState) {
  return { state, ctx: initialMachine().ctx };
}

describe("machine reconnecting", () => {
  it("live -> reconnecting -> live", () => {
    const r1 = transition("live", at("live").ctx, { type: "RECONNECTING" });
    expect(r1.state).toBe("reconnecting");
    const r2 = transition("reconnecting", r1.ctx, { type: "RECONNECTED" });
    expect(r2.state).toBe("live");
  });

  it("paused -> reconnecting preserves nothing illegal, and RECONNECTED returns to live", () => {
    const paused = transition("live", at("live").ctx, { type: "PAUSE", reason: "tab_hidden" });
    const rc = transition("paused", paused.ctx, { type: "RECONNECTING" });
    expect(rc.state).toBe("reconnecting");
    expect(transition("reconnecting", rc.ctx, { type: "RECONNECTED" }).state).toBe("live");
  });

  it("reconnecting -> ended on ENDED", () => {
    const rc = transition("live", at("live").ctx, { type: "RECONNECTING" });
    const ended = transition("reconnecting", rc.ctx, { type: "ENDED", reason: "aborted_technical" });
    expect(ended.state).toBe("ended");
    expect(ended.ctx.endedReason).toBe("aborted_technical");
  });

  it("reconnecting -> error on ERROR", () => {
    const rc = transition("live", at("live").ctx, { type: "RECONNECTING" });
    expect(transition("reconnecting", rc.ctx, { type: "ERROR" }).state).toBe("error");
  });
});
