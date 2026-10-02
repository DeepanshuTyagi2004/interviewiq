import { describe, expect, it } from "vitest";
import { companyResearchStatus, nodeStates, runControls } from "./status";
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
      { name: "resolve", state: "ok" }, { name: "write_draft", state: "running" },
    ]);
    expect(nodeStates(undefined)).toEqual([{ name: "resolve", state: "idle" }, { name: "write_draft", state: "idle" }]);
  });
});
