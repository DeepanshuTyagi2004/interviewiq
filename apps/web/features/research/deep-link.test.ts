import { describe, expect, it } from "vitest";
import { deepLinkHref, parseDeepLink } from "./deep-link";

describe("parseDeepLink", () => {
  it("defaults to companies, and a run id alone opens the runs tab", () => {
    expect(parseDeepLink(new URLSearchParams(""))).toEqual({ tab: "companies", run: null, company: null, span: null });
    expect(parseDeepLink(new URLSearchParams("run=abc&span=s1")).tab).toBe("runs");
    expect(parseDeepLink(new URLSearchParams("tab=bogus")).tab).toBe("companies");
    expect(parseDeepLink(new URLSearchParams("tab=access&run=abc")).tab).toBe("access");
  });
});

describe("deepLinkHref", () => {
  it("sets and clears keys while keeping the rest", () => {
    const current = new URLSearchParams("tab=runs&run=r1&span=s1");
    expect(deepLinkHref(current, { run: "r2", span: null, company: null })).toBe("?tab=runs&run=r2");
    expect(deepLinkHref(new URLSearchParams(""), { tab: "runs", run: "r1" })).toBe("?tab=runs&run=r1");
  });
});
