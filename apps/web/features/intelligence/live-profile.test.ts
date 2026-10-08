import { describe, expect, it, vi } from "vitest";
import { buildLiveTraceReport, streamLiveProfileCalculation, type LiveProfileEvent, type LiveProfileTrace } from "./live-profile";

const apiStreamMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client/client", () => ({ apiStream: (...args: unknown[]) => apiStreamMock(...args) }));

const ev = (seq: number, kind: LiveProfileEvent["kind"], message: string, data?: unknown): LiveProfileEvent =>
  ({ seq, ts: "2026-10-05T10:00:00.000Z", elapsedMs: seq, kind, stage: "semantic", level: kind === "error" ? "error" : "info", message, ...(data === undefined ? {} : { data }) });

function ndjsonResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); } }));
}

describe("streamLiveProfileCalculation", () => {
  it("parses NDJSON across chunk boundaries and posts the options", async () => {
    const a = JSON.stringify(ev(1, "stage", "start")), b = JSON.stringify(ev(2, "llm", "call"));
    apiStreamMock.mockResolvedValue(ndjsonResponse([a.slice(0, 10), `${a.slice(10)}\n${b.slice(0, 5)}`, `${b.slice(5)}\n`, "not json\n"]));
    const events: LiveProfileEvent[] = [];
    await streamLiveProfileCalculation("user-1", { forceReassess: true, onEvent: (event) => events.push(event) });
    expect(apiStreamMock).toHaveBeenCalledWith("/api/v1/intelligence/profile-scoring/live", expect.objectContaining({ method: "POST", json: { userId: "user-1", forceReassess: true } }));
    expect(events.map((event) => event.message)).toEqual(["start", "call", "Unreadable stream line: not json"]);
    expect(events[2]!.kind).toBe("error");
  });
});

describe("buildLiveTraceReport", () => {
  it("puts errors with stacks, LLM payloads and the event log in one pasteable report", () => {
    const report = buildLiveTraceReport({
      userId: "user-1", status: "failed", forceReassess: false, trace: null, clientError: null,
      events: [ev(1, "stage", "AI item assessment...", { id: "semantic", status: "running" }), ev(2, "llm", "-> LLM item-assessment", { request: { requestedFeatures: ["technical_depth"] } }),
        ev(3, "error", "Error: timeout", { name: "Error", message: "timeout", stack: "Error: timeout\n    at x (a.ts:1:1)" })],
    });
    expect(report).toContain("# InterviewIQ profile-scoring live trace");
    expect(report).toContain("Status: **failed**");
    expect(report).toContain("at x (a.ts:1:1)");
    expect(report).toContain('"technical_depth"');
    expect(report).toContain("```ndjson");
    expect(report).not.toContain("## Final trace JSON");
  });

  it("adds the score breakdown and the final trace when the run completed", () => {
    const trace = { traceId: "t1", score: 70, coverage: 80, algorithm: { version: "profile-beta-v5", configHash: "c", inputHash: "i" }, snapshot: { level: "fresher" },
      eligibility: { eligible: true, reasons: [] }, warnings: [], evidence: [], sources: [],
      formula: { expression: "score = sum(weight x score) / 100 (missing = 0)", availableWeight: 100, inputs: [] },
      components: [{ id: "open_source", role: "bonus", status: "available", weight: 17, score: 72, contribution: 13, subFeatures: [{ key: "project_reach", value: 90, weight: 35, share: 35 }] }] } as unknown as LiveProfileTrace;
    const report = buildLiveTraceReport({ userId: "user-1", status: "completed", forceReassess: true, trace, clientError: null, events: [ev(1, "result", "Done", trace)] });
    expect(report).toContain("Formula: score = sum(weight x score) / 100 (missing = 0)");
    expect(report).toContain("| open_source | bonus | available | 17 | 72 | 13 | project_reach=90 @35 (35%) |");
    expect(report).toContain("## Final trace JSON");
    expect(report).toContain('"data":"[see Final trace JSON]"');
  });
});
