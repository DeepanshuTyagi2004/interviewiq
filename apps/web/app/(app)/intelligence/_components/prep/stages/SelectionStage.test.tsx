import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { makeStages } from "../fixtures";
import { SelectionStage } from "./SelectionStage";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const selection = makeStages().find((s) => s.id === "selection")!;

describe("SelectionStage", () => {
  it("renders every candidate with its total, the six breakdown columns ('—' when absent), outcome and reason", () => {
    render(<SelectionStage stage={selection} />);
    const table = screen.getByRole("table");
    const headers = within(table).getAllByRole("columnheader").map((th) => th.textContent);
    expect(headers).toEqual(expect.arrayContaining(["Problem", "Bank difficulty", "Primary", "Total", "Named", "Company", "Topic", "Difficulty", "Level", "Popularity", "Outcome", "Reason"]));

    const twoSum = within(table).getByText("Two Sum").closest("tr")!;
    const cells = within(twoSum).getAllByRole("cell").map((td) => td.textContent);
    // Problem, bank difficulty, primary, total, named, company, topic, difficulty, level, popularity, outcome, reason.
    expect(cells.slice(1, 10)).toEqual(["easy", "hash-table", "72.5", "40", "25", "—", "4", "—", "3.5"]);
    expect(cells[10]).toBe("picked");

    const threeSum = within(table).getByText("3Sum").closest("tr")!;
    expect(threeSum).toHaveTextContent("swapped out");
    expect(threeSum).toHaveTextContent("example 1 mismatch");
  });

  it("shows the slot, its pick, relaxations and swaps above the table, and the summary", () => {
    render(<SelectionStage stage={selection} />);
    expect(screen.getByRole("heading", { name: /core-1/ })).toBeInTheDocument();
    expect(screen.getByText(/drop_company_preference/)).toBeInTheDocument();
    expect(screen.getByText("Swapped out three-sum")).toBeInTheDocument();
    expect(screen.getByText("120 problems")).toBeInTheDocument();
    expect(screen.getByText(/named 40 · company_reported 25/)).toBeInTheDocument();
  });

  it("filters the rows by outcome", async () => {
    const user = userEvent.setup();
    render(<SelectionStage stage={selection} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter outcome" }), "not_drawn");
    const table = screen.getByRole("table");
    expect(within(table).getByText("Valid Anagram")).toBeInTheDocument();
    expect(within(table).queryByText("Two Sum")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter outcome" }), "lost_to_diversity");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("No candidate with this outcome.")).toBeInTheDocument();
  });
});
