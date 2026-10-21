import { describe, expect, it } from "vitest";
import { readinessLine, readinessSummary, trackStatus } from "./readiness";
import type { Loop } from "./types";

const loop = (over: Partial<Loop>): Loop => ({
  id: "l", name: "SDE I", level: "fresher", jdId: "j", processId: null, kind: "official", status: "active", countsTowardReadiness: true, readiness: "progressing",
  confirmedAt: "2030-01-01T00:00:00Z", graph: { nodes: [], edges: [] }, nodeStates: {}, nodeResults: {},
  progress: { total: 4, completed: 1, nextNodeIds: [] }, sessions: [],
  jd: { practiceTemplate: false, jdId: "j", title: "SDE I", company: "meesho", companyName: "Meesho", role: "software-engineer", level: "fresher", specialization: null, techStack: [] },
  ...over,
});

describe("trackStatus", () => {
  it("never calls a target role active", () => {
    expect(trackStatus([], "Meesho · SDE I — Backend")).toEqual({ text: "Target · Meesho · SDE I — Backend", active: false });
    expect(trackStatus([])).toEqual({ text: "No active track", active: false });
  });

  it("names the one active track, counts several, and reports paused ones as not active", () => {
    expect(trackStatus([loop({})])).toEqual({ text: "Active track · Meesho · SDE I", active: true });
    expect(trackStatus([loop({}), loop({ id: "m" })]).text).toBe("2 active tracks");
    expect(trackStatus([loop({ status: "paused" })], "X")).toEqual({ text: "1 paused track", active: false });
    expect(trackStatus([loop({ status: "abandoned" })], "X").text).toBe("Target · X");
  });
});

describe("readinessSummary", () => {
  it("counts only unedited, non-abandoned tracks", () => {
    expect(readinessSummary([])).toBeNull();
    expect(readinessSummary([loop({ kind: "standalone", countsTowardReadiness: false })])).toBeNull();
    expect(readinessSummary([loop({}), loop({ status: "abandoned" }), loop({ kind: "standalone", countsTowardReadiness: false })])).toEqual({ completed: 1, total: 4, label: "Progressing" });
    const template = loop({});
    template.jd!.practiceTemplate = true;
    expect(readinessSummary([template])).toBeNull();
  });
});

describe("readinessSummary label", () => {
  it("names the furthest level reached across unedited tracks", () => {
    expect(readinessSummary([loop({ readiness: "getting_started" }), loop({ id: "m", readiness: "nearly_ready" })])?.label).toBe("Nearly ready");
  });
});

describe("readinessLine", () => {
  it("frames readiness as a mock process, for official loops only", () => {
    expect(readinessLine(loop({}))).toBe("Readiness: Progressing · Meesho Fresher mock process");
    expect(readinessLine(loop({ readiness: "interview_ready" }))).toBe("Interview-ready · Meesho Fresher mock process");
    expect(readinessLine(loop({ kind: "standalone", countsTowardReadiness: false, readiness: null }))).toBeNull();
  });

  it("writes SDE1 for the sde1 level and never says badge, certified or cleared", () => {
    const l = loop({ readiness: "interview_ready" });
    l.jd!.level = "sde1";
    const line = readinessLine(l)!;
    expect(line).toBe("Interview-ready · Meesho SDE1 mock process");
    expect(line).not.toMatch(/badge|certified|cleared/i);
  });
});
