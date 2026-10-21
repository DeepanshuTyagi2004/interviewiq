import { describe, expect, it } from "vitest";
import { FORM_HOLD_MS, MORPH_LOOP, MORPH_MS, nextForm } from "./forms";

describe("mascot morph loop", () => {
  it("runs trio, hopper, jelly, bloom", () => {
    expect(MORPH_LOOP).toEqual(["trio", "hopper", "jelly", "bloom"]);
  });
  it("steps through the loop and wraps from bloom back to trio", () => {
    expect(nextForm("trio")).toBe("hopper");
    expect(nextForm("hopper")).toBe("jelly");
    expect(nextForm("jelly")).toBe("bloom");
    expect(nextForm("bloom")).toBe("trio");
  });
  it("holds a form for 3.6 s and morphs in 0.9 s", () => {
    expect(FORM_HOLD_MS).toBe(3600);
    expect(MORPH_MS).toBe(900);
  });
});
