import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeItem, makeRun, makeSpan } from "@/features/research/testing";

const h = vi.hoisted(() => {
  class FakeApiFetchError extends Error {
    constructor(readonly status: number, message: string) {
      super(message);
    }
  }
  return {
  Err: FakeApiFetchError,
  search: "",
  replace: vi.fn(),
  refetchSpans: vi.fn(),
  refetchEvents: vi.fn(),
  runs: {} as Record<string, unknown>,
  detail: {} as Record<string, unknown>,
  spans: {} as Record<string, unknown>,
  events: {} as Record<string, unknown>,
  };
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: h.replace }),
  useSearchParams: () => new URLSearchParams(h.search),
}));
vi.mock("@/lib/api-client/client", () => ({ ApiFetchError: h.Err, apiFetch: vi.fn() }));
vi.mock("@/features/research", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/research")>()),
  useResearchRuns: () => h.runs,
  useResearchRun: () => h.detail,
  useRunSpans: () => h.spans,
  useRunEvents: () => h.events,
  getSpan: vi.fn(),
}));
vi.mock("./RunControlBar", () => ({ RunControlBar: () => <div data-testid="controls" /> }));
vi.mock("./BudgetMeters", () => ({ BudgetMeters: () => null }));
vi.mock("./SpanDetail", () => ({ SpanDetail: () => null }));
vi.mock("./LiveConsole", () => ({ LiveConsole: () => null }));
vi.mock("./TraceTree", () => ({
  TraceTree: ({ onSelectSpan }: { onSelectSpan: (s: unknown) => void }) => (
    <button onClick={() => onSelectSpan(makeSpan({ span_id: "sp1", company_id: "c-meesho" }))}>select span</button>
  ),
}));

import { RunsTab } from "./RunsTab";

const run1 = makeRun({ run_id: "1".repeat(32), status: "running" });
const ok = (data: unknown) => ({ data, isPending: false, isError: false, error: null });

beforeEach(() => {
  vi.clearAllMocks();
  h.search = "tab=runs";
  h.runs = ok({ runs: [run1] });
  h.detail = ok({ run: run1, items: [makeItem()] });
  h.spans = { ...ok({ spans: [] }), refetch: h.refetchSpans };
  h.events = { events: [], error: null, refetch: h.refetchEvents, loadOlder: vi.fn(), canLoadOlder: false, loadingOlder: false };
});

describe("RunsTab", () => {
  it("pins the resolved run when selecting a span with no run param", async () => {
    render(<RunsTab />);
    await userEvent.click(screen.getByRole("button", { name: "select span" }));
    expect(h.replace).toHaveBeenCalledWith(`?tab=runs&run=${run1.run_id}&span=sp1&company=c-meesho`, { scroll: false });
  });

  it("refetches spans and events once when the run stops being live", () => {
    const { rerender } = render(<RunsTab />);
    expect(h.refetchSpans).not.toHaveBeenCalled();
    h.detail = ok({ run: { ...run1, status: "completed" }, items: [] });
    rerender(<RunsTab />);
    expect(h.refetchSpans).toHaveBeenCalledTimes(1);
    expect(h.refetchEvents).toHaveBeenCalledTimes(1);
    rerender(<RunsTab />);
    expect(h.refetchSpans).toHaveBeenCalledTimes(1);
  });

  it("does not refetch events for a different run whose detail is still pending", () => {
    const runB = "2".repeat(32);
    const { rerender } = render(<RunsTab />);
    h.search = `tab=runs&run=${runB}`;
    h.detail = { data: undefined, isPending: true, isError: false, error: null };
    rerender(<RunsTab />);
    expect(h.refetchEvents).not.toHaveBeenCalled();
    expect(h.refetchSpans).not.toHaveBeenCalled();
  });

  it("keeps the debugger and shows an inline alert when a background runs poll fails", () => {
    h.search = `tab=runs&run=${run1.run_id}`;
    h.runs = { data: { runs: [run1] }, isPending: false, isError: true, error: new h.Err(500, "poll failed") };
    render(<RunsTab />);
    expect(screen.getByRole("alert")).toHaveTextContent("poll failed");
    expect(screen.getByTestId("controls")).toBeInTheDocument();
  });

  it("shows a loading line while runs load, not the empty state", () => {
    h.runs = { data: undefined, isPending: true, isError: false, error: null };
    render(<RunsTab />);
    expect(screen.getByText(/loading research runs/i)).toBeInTheDocument();
    expect(screen.queryByTestId("controls")).not.toBeInTheDocument();
  });

  it("alerts when the runs list fails", () => {
    h.runs = { data: undefined, isPending: false, isError: true, error: new h.Err(500, "boom") };
    render(<RunsTab />);
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
  });

  it("says the run was not found and offers a way back", async () => {
    h.search = "tab=runs&run=missing";
    h.detail = { data: undefined, isPending: false, isError: true, error: new h.Err(404, "nope") };
    render(<RunsTab />);
    expect(screen.getByRole("alert")).toHaveTextContent(/not found/i);
    await userEvent.click(screen.getByRole("button", { name: "Back to latest run" }));
    expect(h.replace).toHaveBeenCalledWith("?tab=runs", { scroll: false });
  });
});
