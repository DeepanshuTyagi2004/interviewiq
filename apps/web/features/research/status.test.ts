import { describe, expect, it } from "vitest";
import { companyResearchStatus, companyStatusLabel, nodeStates, runControls } from "./status";
import { makeCompany, makeItem } from "./testing";
import type { CompanyResearchState } from "./types";

const state = (over: Partial<CompanyResearchState>): CompanyResearchState => ({
  lastRunId: "r1", lastResearchedAt: null, lastStatus: null, latestDraftId: null, latestDraftStatus: null, ...over,
});
const PUBLISHED = "2026-01-01T00:00:00Z";

describe("companyResearchStatus", () => {
  it.each([
    [makeCompany(), "never_researched"],
    [makeCompany({ research: state({ lastStatus: "queued" }) }), "queued"],
    [makeCompany({ research: state({ lastStatus: "running" }) }), "researching"],
    [makeCompany({ research: state({ lastStatus: "paused" }) }), "researching"],
    [makeCompany({ research: state({ lastStatus: "failed" }) }), "failed"],
    [makeCompany({ research: state({ lastStatus: "done", latestDraftStatus: "pending_review" }) }), "awaiting_review"],
    [makeCompany({ publishedAt: PUBLISHED, research: state({ lastStatus: "done", latestDraftStatus: "pending_review" }) }), "update_pending"],
    [makeCompany({ publishedAt: PUBLISHED }), "published"],
    [makeCompany({ publishedAt: PUBLISHED, research: state({ lastStatus: "skipped", latestDraftStatus: "approved" }) }), "published"],
  ] as const)("%#: %s", (company, expected) => {
    expect(companyResearchStatus(company)).toBe(expected);
  });
});

describe("companyStatusLabel", () => {
  const pending = (over: Partial<CompanyResearchState>) =>
    state({ lastStatus: "done", latestDraftStatus: "pending_review", ...over });
  it.each([
    [makeCompany({ research: pending({ latestDraftCoverage: { filled: 18, total: 34 } }) }), "Awaiting review · partial 18/34"],
    [makeCompany({ research: pending({ latestDraftCoverage: { filled: 8, total: 8 } }) }), "Awaiting review"],
    [makeCompany({ publishedAt: PUBLISHED, research: pending({ latestDraftCoverage: { filled: 3, total: 13 } }) }),
      "Published · update pending review · partial 3/13"],
    [makeCompany({ publishedAt: PUBLISHED, research: state({ lastStatus: "done", latestDraftStatus: "approved",
      latestDraftCoverage: { filled: 3, total: 13 } }) }), "Published"],
    [makeCompany({ research: pending({}) }), "Awaiting review"],
  ] as const)("%#: %s", (company, expected) => {
    expect(companyStatusLabel(company)).toBe(expected);
  });
});

describe("runControls", () => {
  it.each([
    ["running", { start: false, pause: true, resume: false, stop: true }],
    ["queued", { start: false, pause: true, resume: false, stop: true }],
    ["pausing", { start: false, pause: false, resume: false, stop: true }],
    ["paused", { start: false, pause: false, resume: true, stop: true }],
    ["stopping", { start: false, pause: false, resume: false, stop: false }],
    ["completed", { start: true, pause: false, resume: false, stop: false }],
    [undefined, { start: true, pause: false, resume: false, stop: false }],
  ] as const)("%s", (status, expected) => {
    expect(runControls(status)).toEqual(expected);
  });

  it("disables everything while a control request is in flight", () => {
    expect(runControls("paused", true)).toEqual({ start: false, pause: false, resume: false, stop: false });
  });
});

describe("nodeStates", () => {
  it("lists every graph node in order, idle until it starts", () => {
    expect(nodeStates(makeItem({ nodes: { resolve: { status: "ok" }, write_draft: { status: "running" } } }))).toEqual([
      { name: "resolve", state: "ok" }, { name: "profile", state: "idle" }, { name: "write_draft", state: "running" },
    ]);
    expect(nodeStates(undefined)).toEqual([{ name: "resolve", state: "idle" }, { name: "profile", state: "idle" }, { name: "write_draft", state: "idle" }]);
  });
  it("retains historical research steps in old traces", () => {
    const states = nodeStates(makeItem({ nodes: { compensation: { status: "ok" }, roles: { status: "error" } } }));
    expect(states).toContainEqual({ name: "compensation", state: "ok" });
    expect(states).toContainEqual({ name: "roles", state: "error" });
    expect(states.at(-1)?.name).toBe("write_draft");
  });
});
