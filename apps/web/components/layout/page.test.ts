import { describe, expect, it } from "vitest";
import { PAGE_SCAFFOLD } from "./page";

describe("PAGE_SCAFFOLD", () => {
  it("uses the dashboard shell width and responsive gutters", () => {
    expect(PAGE_SCAFFOLD).toContain("iq-page");
    expect(PAGE_SCAFFOLD).toContain("max-w-[1760px]");
    expect(PAGE_SCAFFOLD).toContain("px-[calc(16*var(--u))]");
    expect(PAGE_SCAFFOLD).toContain("sm:px-[calc(26*var(--u))]");
    expect(PAGE_SCAFFOLD).toContain("pb-[calc(24*var(--u))]");
    expect(PAGE_SCAFFOLD).toContain("pt-[calc(26*var(--u))]");
    expect(PAGE_SCAFFOLD).not.toContain("max-w-[1600px]");
  });
});
