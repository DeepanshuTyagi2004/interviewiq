import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { QuestionRecord } from "@/features/intelligence";
import { ProblemBankTab } from "./ProblemBankTab";

const state = vi.hoisted(() => ({ generate: vi.fn(), collect: vi.fn(), running: false }));
const dsa: QuestionRecord = {
  slug: "two-sum", round_type: "dsa", title: "Two Sum", url: "https://leetcode.com/problems/two-sum/", sources: ["snehasishroy"], difficulty: "easy",
  topic_tags: ["Array", "Hash Table"], company_tags: ["amazon", "flipkart"], company_evidence: { amazon: "reported", flipkart: "inferred" }, level_tags: ["fresher"],
  enrichment_status: "raw", content_status: "verified", content_model: "groq/test",
  content: {
    statement: "Given a list of ticket prices and a budget, return the indices of the two tickets whose prices add up exactly to the budget.",
    input_format: "prices: list[int], budget: int", output_format: "list[int]", constraints: ["2 <= len(prices) <= 10^4"],
    examples: [{ args: { prices: [2, 7, 11], budget: 9 }, expected: [0, 1], explanation: "2 + 7 = 9" }, { args: { prices: [3, 3], budget: 6 }, expected: [0, 1], explanation: "Both tickets cost 3" }],
    judge_tests: [{ args: { prices: [1, 2], budget: 3 }, expected: [0, 1] }], hints: ["Think about complements.", "Use a map from price to index.", "One pass is enough."],
    follow_ups: ["What if prices are sorted?"], approaches: [{ name: "Hash map", idea: "Store seen prices", time_complexity: "O(n)", space_complexity: "O(n)" }],
    reference_solution: { language: "python", entry_point: "two_sum", code: "def two_sum(prices, budget):\n    return [0, 1]\n" },
    rubric: [{ criterion: "correctness", weight: 3, strong: "handles duplicates", weak: "misses duplicates" }], what_it_tests: "Hash-map lookups.", estimated_minutes: 15,
  },
};
vi.mock("@/features/intelligence", () => ({
  useQuestionBankStats: () => ({ data: { rounds: { dsa: { none: 10, verified: 2 }, lld: { generated: 1 } }, total: 13 }, isLoading: false }),
  useScrapeStatus: () => ({ data: { status: state.running ? "running" : "completed", stage: state.running ? "question_content" : null, stages: { question_content: { candidates: 25, verified: 20, generated: 0, unverified: 3, failed: 2 } } } }),
  useTriggerCollect: () => ({ mutate: state.collect, isPending: false }),
  useTriggerQuestionGeneration: () => ({ mutate: state.generate, isPending: false }),
  useProblemBank: () => ({ data: { questions: [dsa], count: 1, returned: 1 }, isError: false }),
}));

beforeEach(() => { vi.clearAllMocks(); state.running = false; });

describe("ProblemBankTab", () => {
  it("shows counts per round and status and the last run's content counts", () => {
    render(<ProblemBankTab />);
    expect(screen.getByText("13 problems")).toBeInTheDocument();
    const statsTable = screen.getAllByRole("table")[0]!;
    const dsaRow = within(statsTable).getByText("DSA").closest("tr")!;
    expect(dsaRow.textContent).toContain("10");
    expect(screen.getByText(/candidates 25, verified 20, generated 0, unverified 3, failed 2/)).toBeInTheDocument();
  });

  it("starts generation with the chosen round, limit and force flag", async () => {
    const user = userEvent.setup();
    render(<ProblemBankTab />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Generate round" }), "system-design");
    await user.clear(screen.getByRole("spinbutton", { name: "Generate limit" }));
    await user.type(screen.getByRole("spinbutton", { name: "Generate limit" }), "40");
    await user.click(screen.getByRole("checkbox", { name: /Regenerate current/ }));
    await user.click(screen.getByRole("button", { name: "Generate content" }));
    expect(state.generate).toHaveBeenCalledWith({ roundType: "system-design", limit: 40, force: true });
    await user.click(screen.getByRole("button", { name: "Collect index" }));
    expect(state.collect).toHaveBeenCalled();
  });

  it("disables the controls while a run is in progress", () => {
    state.running = true;
    render(<ProblemBankTab />);
    expect(screen.getByRole("button", { name: "Generate content" })).toBeDisabled();
    expect(screen.getByText(/Running · question_content/)).toBeInTheDocument();
  });

  it("opens a problem and shows its statement, examples, hints, rubric and inferred company marker", async () => {
    const user = userEvent.setup();
    render(<ProblemBankTab />);
    expect(screen.getByText("amazon, flipkart? · Array, Hash Table")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Two Sum/ }));
    expect(screen.getByText(/ticket prices and a budget/)).toBeInTheDocument();
    expect(screen.getByText("Examples (2)")).toBeInTheDocument();
    expect(screen.getByText(/Think about complements/)).toBeInTheDocument();
    expect(screen.getByText("handles duplicates")).toBeInTheDocument();
    expect(screen.getByText(/def two_sum/)).toBeInTheDocument();
  });
});
