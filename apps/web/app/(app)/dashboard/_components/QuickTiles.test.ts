import { describe, expect, it } from "vitest";
import type { JdSummary } from "@/features/jobs";
import { rolesSubtitle } from "./QuickTiles";

const jd = (over: Partial<JdSummary> = {}) => ({ id: "j", practiceTemplate: false, ...over }) as JdSummary;

describe("rolesSubtitle", () => {
  it("counts open roles, ignoring practice templates", () => {
    expect(rolesSubtitle([jd(), jd(), jd({ practiceTemplate: true })], false)).toBe("2 open roles");
    expect(rolesSubtitle([jd()], false)).toBe("1 open role");
    expect(rolesSubtitle(Array.from({ length: 1240 }, () => jd()), false)).toBe("1,240 open roles");
  });
  it("falls back to static copy while loading, on error and with nothing to count", () => {
    expect(rolesSubtitle(undefined, false)).toBe("Browse every role");
    expect(rolesSubtitle([jd()], true)).toBe("Browse every role");
    expect(rolesSubtitle([], false)).toBe("Browse every role");
  });
});
