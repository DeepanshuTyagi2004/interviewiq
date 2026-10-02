import { afterEach, describe, expect, it } from "vitest";
import { consumeNext, rememberNext, safeNextPath } from "./next";

describe("safeNextPath", () => {
  it("keeps same-origin paths", () => {
    expect(safeNextPath("/jobs/123?tab=insights")).toBe("/jobs/123?tab=insights");
  });

  it("rejects anything that could leave the site", () => {
    for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "evil", "", null, undefined]) {
      expect(safeNextPath(bad)).toBe("/dashboard");
    }
  });
});

describe("rememberNext / consumeNext", () => {
  afterEach(() => sessionStorage.clear());

  it("round-trips once, sanitised", () => {
    rememberNext("/interviews");
    expect(consumeNext()).toBe("/interviews");
    expect(consumeNext()).toBeNull();

    rememberNext("//evil.example");
    expect(consumeNext()).toBe("/dashboard");
  });
});
