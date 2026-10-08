import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BlueprintRunFilters } from "@/features/blueprints";
import { diff, makeRunDetail, makeRunSummary, versions } from "./fixtures";

const h = vi.hoisted(() => ({
  search: "tab=prep",
  replace: vi.fn(),
  rerun: vi.fn(),
  runsCalls: [] as Record<string, unknown>[],
  runs: {} as Record<string, unknown>,
  morePage: {} as Record<string, unknown>,
  run: {} as Record<string, unknown>,
  runIds: [] as (string | null)[],
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: h.replace }),
  useSearchParams: () => new URLSearchParams(h.search),
}));
vi.mock("@/features/blueprints", () => ({
  useBlueprintRuns: (f: BlueprintRunFilters) => {
    h.runsCalls.push(f as Record<string, unknown>);
    return f.cursor ? h.morePage : h.runs;
  },
  useBlueprintRun: (id: string | null) => {
    h.runIds.push(id);
    return id ? h.run : { data: undefined, isPending: false, isError: false, error: null };
  },
  useBenchCandidates: () => ({ data: [], isPending: false, isError: false }),
  useStartBench: () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null }),
  useRerunBlueprint: () => ({ mutate: h.rerun, isPending: false, error: null }),
  useBlueprintVersions: () => ({ data: versions, isPending: false, isError: false, error: null }),
  useBlueprintDiff: () => ({ data: diff, isPending: false, isError: false, error: null }),
}));

import { PrepTab } from "./PrepTab";

const ok = (data: unknown) => ({ data, isPending: false, isError: false, error: null });
const running = makeRunSummary({ run_id: "run_running0001", status: "running", stage: "selection", trigger: "bench", candidate_label: null, session_id: null, duration_ms: null, blueprint_version: null });
const failed = makeRunSummary({ run_id: "run_failed00001", status: "failed", company: "Flipkart", role: "SDE II", level: "sde2", round_type: "system-design", error: { code: "not_enough_problems", message: "slot core-1" } });
const cached = makeRunSummary({ run_id: "run_cached00001", cached: true, trigger: "refresh" });

beforeEach(() => {
  vi.clearAllMocks();
  h.search = "tab=prep";
  h.runsCalls = [];
  h.runIds = [];
  h.runs = ok({ runs: [running, failed, cached], next_cursor: "cursor-2" });
  h.morePage = ok({ runs: [makeRunSummary({ run_id: "run_older00001", company: "Swiggy" })], next_cursor: null });
  h.run = ok(makeRunDetail());
});

describe("PrepTab · run list", () => {
  it("renders one row per run with company · role · level · round, candidate, status, trigger and cached marker", () => {
    render(<PrepTab />);
    const list = screen.getByRole("list", { name: "Runs" });
    const rows = within(list).getAllByRole("button");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("Meesho · SDE I · sde1 · DSA");
    expect(rows[0]).toHaveTextContent("running · selection");
    expect(rows[0]).toHaveTextContent("bench");
    // No label: the candidate id stands in.
    expect(rows[0]).toHaveTextContent("11111111-1111-4111-8111-111111111111");
    expect(rows[1]).toHaveTextContent("Flipkart · SDE II · sde2 · System design");
    expect(rows[1]).toHaveTextContent("failed");
    expect(rows[1]).toHaveTextContent("not_enough_problems");
    expect(rows[2]).toHaveTextContent("Asha Verma");
    expect(rows[2]).toHaveTextContent("cached");
    expect(rows[2]).toHaveTextContent("refresh");
  });

  it("selects a run into ?bpr= without touching the research tab's ?run=", async () => {
    const user = userEvent.setup();
    h.search = "tab=prep&run=research-run-1";
    render(<PrepTab />);
    await user.click(screen.getByRole("button", { name: /Flipkart · SDE II/ }));
    expect(h.replace).toHaveBeenCalledWith("?tab=prep&run=research-run-1&bpr=run_failed00001", { scroll: false });
  });

  it("passes the select filters straight through and the typed filters once they settle", async () => {
    const user = userEvent.setup();
    render(<PrepTab />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter status" }), "failed");
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter round type" }), "system-design");
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter trigger" }), "booking");
    expect(h.runsCalls.at(-1)).toMatchObject({ status: "failed", round_type: "system-design", trigger: "booking" });
    await user.type(screen.getByRole("textbox", { name: "Filter company" }), "flip");
    await user.type(screen.getByRole("textbox", { name: "Filter candidate id" }), "c-9");
    await waitFor(() => expect(h.runsCalls.at(-1)).toMatchObject({ company: "flip", candidate_id: "c-9", status: "failed" }));
  });

  it("loads the next page by cursor", async () => {
    const user = userEvent.setup();
    render(<PrepTab />);
    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(h.runsCalls.some((f) => f.cursor === "cursor-2")).toBe(true);
    expect(screen.getByRole("list", { name: "More runs" })).toHaveTextContent("Swiggy");
    // The last page has no cursor: no more "Load more".
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no runs", () => {
    h.runs = ok({ runs: [], next_cursor: null });
    render(<PrepTab />);
    expect(screen.getByText("No blueprint runs yet")).toBeInTheDocument();
    expect(screen.getByText("Pick a run")).toBeInTheDocument();
  });
});

describe("PrepTab · run detail", () => {
  it("reads the selected run from ?bpr= and shows the header and all eight stages", () => {
    h.search = "tab=prep&bpr=run_aaaaaaaaaaaa";
    render(<PrepTab />);
    expect(h.runIds).toContain("run_aaaaaaaaaaaa");
    const header = screen.getByRole("region", { name: "Run run_aaaaaaaaaaaa" });
    expect(header).toHaveTextContent("abcdef123456");
    expect(header).toHaveTextContent("sess-1");
    const stages = screen.getByRole("region", { name: "Stages" });
    const items = within(stages).getAllByRole("button");
    expect(items).toHaveLength(8);
    expect(items[0]).toHaveTextContent("Context");
    expect(items[2]).toHaveTextContent("groq/llama-3.3-70b");
    expect(items[2]).toHaveTextContent("2,400 tok");
    expect(items[5]).toHaveTextContent("Failed");
    expect(items[7]).toHaveTextContent("Assemble and validate");
    expect(items[7]).toHaveTextContent("Pending");
  });

  it("shows the run's failure with code, message and stage", () => {
    h.search = "tab=prep&bpr=run_failed00001";
    h.run = ok(makeRunDetail({ run_id: "run_failed00001", status: "failed", blueprint: null, briefing: null, error: { code: "playbook_failed", message: "branches: missing nervous", stage: "playbooks" } }));
    render(<PrepTab />);
    const alert = within(screen.getByRole("region", { name: "Run run_failed00001" })).getAllByRole("alert")[0]!;
    expect(alert).toHaveTextContent("playbook_failed");
    expect(alert).toHaveTextContent("at playbooks");
    expect(alert).toHaveTextContent("branches: missing nervous");
  });

  it("opens the selection stage drawer with the breakdown columns and outcomes", async () => {
    const user = userEvent.setup();
    h.search = "tab=prep&bpr=run_aaaaaaaaaaaa";
    render(<PrepTab />);
    await user.click(screen.getByRole("button", { name: /Problem selection/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Problem selection" })).toBeInTheDocument();
    const table = within(dialog).getByRole("table");
    for (const col of ["Named", "Company", "Topic", "Difficulty", "Level", "Popularity"]) {
      expect(within(table).getByRole("columnheader", { name: col })).toBeInTheDocument();
    }
    expect(within(table).getByText("picked")).toBeInTheDocument();
    expect(within(table).getByText("swapped out")).toBeInTheDocument();
  });

  it("opens an LLM stage drawer with prompts, validity and the stage error", async () => {
    const user = userEvent.setup();
    h.search = "tab=prep&bpr=run_aaaaaaaaaaaa";
    render(<PrepTab />);
    await user.click(screen.getByRole("button", { name: /Playbooks/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getAllByText("playbook_failed").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("playbook:core-1")).toBeInTheDocument();
    expect(within(dialog).getByText("invalid")).toBeInTheDocument();
    expect(within(dialog).getByText("branches: missing nervous")).toBeInTheDocument();
    expect(within(dialog).getByText("System prompt")).toBeInTheDocument();
    expect(within(dialog).getByText("Raw reply")).toBeInTheDocument();
  });

  it("re-runs without the answer-key cache and selects the new run", async () => {
    const user = userEvent.setup();
    h.search = "tab=prep&bpr=run_aaaaaaaaaaaa";
    h.rerun.mockImplementation((_body: unknown, opts: { onSuccess: (r: { run_id: string }) => void }) => opts.onSuccess({ run_id: "run_new0000001" }));
    render(<PrepTab />);
    await user.click(screen.getByRole("button", { name: "Re-run without answer-key cache" }));
    expect(h.rerun).toHaveBeenCalledWith({ id: "run_aaaaaaaaaaaa", bypassAnswerKeyCache: true }, expect.anything());
    expect(h.replace).toHaveBeenCalledWith("?tab=prep&bpr=run_new0000001", { scroll: false });
  });

  it("renders the blueprint: briefing, branch table and the version diff", async () => {
    const user = userEvent.setup();
    h.search = "tab=prep&bpr=run_aaaaaaaaaaaa";
    render(<PrepTab />);
    const briefing = screen.getByRole("region", { name: "What the candidate sees" });
    expect(briefing).toHaveTextContent("45-minute coding interview with a shared editor");
    await user.click(screen.getByRole("button", { name: /core 1.*Two Sum/ }));
    const branches = screen.getByRole("region", { name: "Branches for core-1" });
    const stuck = within(branches).getByText("stuck").closest("tr")!;
    expect(stuck).toHaveTextContent("give_hint");
    expect(stuck).toHaveTextContent("What would you need to know about each price?");
    const versionsCard = screen.getByRole("region", { name: "Versions" });
    expect(versionsCard).toHaveTextContent("profile");
    expect(versionsCard).toHaveTextContent("valid-anagram");
    expect(versionsCard).toHaveTextContent("Truncated");
  });
});
