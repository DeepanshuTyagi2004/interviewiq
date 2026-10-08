import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LiveProfileEvent, LiveProfileTrace } from "@/features/intelligence";
import { scoringWrapper } from "@/features/profile-scoring/test-fixtures";
import { copyLiveProfileTrace, LiveProfileTab } from "./LiveProfileTab";

const fetchMock = vi.hoisted(() => vi.fn());
const streamMock = vi.hoisted(() => vi.fn());
const toastSuccess = vi.hoisted(() => vi.fn());
const toastError = vi.hoisted(() => vi.fn());
const clipboardWriteText = vi.hoisted(() => vi.fn());
const ApiFetchErrorMock = vi.hoisted(() => class extends Error {
  status: number;
  code: string | undefined;
  constructor(status: number, code: string | undefined, message: string) { super(message); this.status = status; this.code = code; }
});
vi.mock("@/lib/api-client/client", () => ({ ApiFetchError: ApiFetchErrorMock, apiFetch: (...args: unknown[]) => fetchMock(...args), apiStream: vi.fn() }));
vi.mock("@/features/intelligence", async (original) => ({ ...(await original<typeof import("@/features/intelligence")>()), streamLiveProfileCalculation: (...args: unknown[]) => streamMock(...args) }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, error: toastError } }));

const users = [
  { id: "user-ada", name: "Ada Lovelace", email: "ada@example.test", role: "USER" as const },
  { id: "user-grace", name: "Grace Hopper", email: "grace@example.test", role: "ADMIN" as const },
];

const trace = {
  traceId: "trace-123", userId: "user-ada", startedAt: "2026-10-04T10:00:00.000Z", finishedAt: "2026-10-04T10:00:00.125Z",
  stages: [{ id: "engine", status: "completed", startedAt: "2026-10-04T10:00:00.000Z", finishedAt: "2026-10-04T10:00:00.010Z", durationMs: 10, detail: "Score 82." }],
  sources: [{ source: "CODEFORCES", status: "available", fetchedAt: "2026-10-04T09:00:00.000Z", ageDays: 0, contentHash: "cf-hash", extractedFieldCounts: { byTopic: 4 }, safeSummary: { used: true } }],
  providerChecks: [{ provider: "AI service: item assessment", mode: "profile-scoring-assessment-prompt-v3", configured: true, used: true, status: "used", retrievedAt: null, reason: "1 assessed, 0 reused, 0 skipped, 0 failed" }],
  score: 82, confidence: 100, coverage: 90, classification: { declaredLevel: "fresher", assessedLevel: "fresher", confidence: 100, reasons: [], warnings: [] },
  algorithm: { version: "profile-beta-v5", configHash: "config-123", inputHash: "input-123" },
  components: [{ id: "open_source", label: "Open source contribution", weight: 17, score: 72.5, contribution: 13.7, evidenceIds: ["evidence-1"], status: "available", availableWeight: 90, formulaInput: { score: 72.5, weight: 17 },
    subFeatures: [{ key: "project_reach", value: 90, weight: 35, share: 35 }] }],
  evidence: [{ id: "evidence-1", source: "github", path: "fragments.github.mergedPullRequests.project_reach", claim: "Open source project reach", value: 90, confidence: 100, observedAt: null, verification: "collector", recencyFactor: 1, feature: "project_reach", evidenceType: "DERIVED", scoreContribution: 13.7 }],
  eligibility: { eligible: true, reasons: [] }, warnings: ["1 merged pull request(s) not counted"],
  formula: { expression: "sum(component.score * component.weight) / availableWeight", availableWeight: 90, inputs: [] },
  snapshot: { id: "snap-1", level: "fresher" }, llmCalls: [], stackTrace: "PROFILE_SCORING_TRACE\nEND_PROFILE_SCORING_TRACE", copyText: "PROFILE_SCORING_TRACE\nEND_PROFILE_SCORING_TRACE",
} as unknown as LiveProfileTrace;

let seq = 0;
const event = (kind: LiveProfileEvent["kind"], stage: string, message: string, data?: unknown, level: LiveProfileEvent["level"] = "info"): LiveProfileEvent =>
  ({ seq: ++seq, ts: "2026-10-04T10:00:00.000Z", elapsedMs: seq * 10, kind, stage, level, message, ...(data === undefined ? {} : { data }) });

function renderTab() {
  return render(<LiveProfileTab />, { wrapper: scoringWrapper().wrapper });
}

async function selectAda(user: ReturnType<typeof userEvent.setup>) {
  const input = await screen.findByRole("combobox", { name: "Select user" });
  await user.click(input);
  await user.type(input, "ada");
  await user.click(await screen.findByRole("option", { name: /Ada Lovelace/ }));
}

describe("LiveProfileTab", () => {
  beforeEach(() => {
    seq = 0;
    fetchMock.mockReset();
    streamMock.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    fetchMock.mockImplementation(() => Promise.resolve(users));
    clipboardWriteText.mockReset();
    clipboardWriteText.mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText: clipboardWriteText } });
  });

  it("searches users by name, email, and id with an accessible combobox", async () => {
    const user = userEvent.setup();
    renderTab();
    const input = await screen.findByRole("combobox", { name: "Select user" });
    await user.click(input);
    expect(input).toHaveAttribute("aria-controls", "live-profile-user-listbox");
    await user.type(input, "grace");
    const listbox = await screen.findByRole("listbox", { name: "Available users" });
    await user.click(within(listbox).getByRole("option", { name: /Grace Hopper/ }));
    expect(screen.getByText("Grace Hopper")).toBeInTheDocument();
    expect(screen.getByText("Ready to calculate.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run live calculation" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Copy full trace for Claude Code" })).toBeDisabled();
  });

  it("streams stages, LLM calls and the final breakdown as events arrive", async () => {
    const user = userEvent.setup();
    let push!: (event: LiveProfileEvent) => void, finish!: () => void;
    streamMock.mockImplementation((_userId: string, opts: { onEvent: (event: LiveProfileEvent) => void }) => new Promise<void>((resolve) => { push = opts.onEvent; finish = resolve; }));
    renderTab();
    await selectAda(user);
    await user.click(screen.getByRole("checkbox", { name: /Force re-assess/ }));
    await user.click(screen.getByRole("button", { name: "Run live calculation" }));
    expect(streamMock).toHaveBeenCalledWith("user-ada", expect.objectContaining({ forceReassess: true }));
    expect(await screen.findByText("Running…")).toBeInTheDocument();
    push(event("stage", "semantic", "AI item assessment...", { id: "semantic", status: "running" }));
    push(event("llm", "semantic", '-> LLM item-assessment for project "QueueLite"', { callId: "c1", request: { requestedFeatures: ["technical_depth"] } }));
    expect(await screen.findByText('-> LLM item-assessment for project "QueueLite"')).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Live log" })).toBeInTheDocument();
    push(event("result", "trace", "Done", trace));
    finish();
    expect(await screen.findByText("Run summary")).toBeInTheDocument();
    expect(screen.getByText("Score breakdown")).toBeInTheDocument();
    expect(screen.getByText("project_reach", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("CODEFORCES")).toBeInTheDocument();
    expect(screen.getByText("AI service: item assessment")).toBeInTheDocument();
    // Stages and LLM calls carry their own "completed" pills; this is the run's.
    expect(within(screen.getByRole("region", { name: "Run summary" })).getByText("completed", { selector: "span" })).toBeInTheDocument();
  });

  it("shows a streamed error with its stack and keeps the copy button available", async () => {
    const user = userEvent.setup();
    // userEvent.setup() installs its own clipboard; put the spy back so the copy is observable.
    vi.stubGlobal("navigator", { clipboard: { writeText: clipboardWriteText } });
    streamMock.mockImplementation(async (_userId: string, opts: { onEvent: (event: LiveProfileEvent) => void }) => {
      opts.onEvent(event("stage", "semantic", "AI item assessment: FAILED", { id: "semantic", status: "failed" }, "error"));
      opts.onEvent(event("error", "semantic", "Error: upstream LLM timeout", { name: "Error", message: "upstream LLM timeout", stack: "Error: upstream LLM timeout\n    at assess (profileScoring.ts:1:1)" }, "error"));
    });
    renderTab();
    await selectAda(user);
    await user.click(screen.getByRole("button", { name: "Run live calculation" }));
    expect(await screen.findByText(/at assess \(profileScoring\.ts:1:1\)/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy full trace for Claude Code" }));
    expect(clipboardWriteText).toHaveBeenCalledWith(expect.stringContaining("## Errors"));
    expect(clipboardWriteText.mock.calls[0]![0]).toContain("at assess (profileScoring.ts:1:1)");
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("reports HTTP errors inline and keeps the selected user", async () => {
    const user = userEvent.setup();
    streamMock.mockRejectedValue(new ApiFetchErrorMock(403, "forbidden", "Admin access required"));
    renderTab();
    await selectAda(user);
    await user.click(screen.getByRole("button", { name: "Run live calculation" }));
    expect(await screen.findByText(/403/)).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run live calculation" })).toBeEnabled();
  });

  it("copies text through the clipboard helper", async () => {
    await copyLiveProfileTrace("report", clipboardWriteText);
    expect(clipboardWriteText).toHaveBeenCalledWith("report");
  });
});
