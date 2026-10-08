import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { slot } from "../fixtures";
import { BranchTable } from "./BranchTable";

describe("BranchTable", () => {
  it("renders each branch as condition → action → say, with notes", () => {
    render(<BranchTable branches={slot.branches} roundType="dsa" />);
    const stuck = screen.getByText("stuck").closest("tr")!;
    const cells = within(stuck).getAllByRole("cell").map((td) => td.textContent);
    expect(cells).toEqual(["stuck", "→give_hint", "What would you need to know about each price?", "first rung of the ladder"]);
    const optimal = screen.getByText("correct_optimal").closest("tr")!;
    expect(optimal).toHaveTextContent("ask_complexity");
    expect(optimal).toHaveTextContent("Nice. What is the time complexity?");
    expect(within(optimal).getAllByRole("cell")[3]).toHaveTextContent("—");
  });

  it("groups the conditions every round has apart from the round family's own, in vocabulary order", () => {
    const { container } = render(<BranchTable branches={slot.branches} roundType="dsa" />);
    const groups = Array.from(container.querySelectorAll('th[scope="colgroup"]')).map((th) => th.textContent);
    expect(groups).toEqual(["Every round · 2", "DSA conditions · 1"]);
    const rows = screen.getAllByRole("row").map((r) => r.textContent ?? "");
    const stuckAt = rows.findIndex((t) => t.startsWith("stuck"));
    const answerAt = rows.findIndex((t) => t.startsWith("asks_for_answer"));
    const optimalAt = rows.findIndex((t) => t.startsWith("correct_optimal"));
    expect(stuckAt).toBeLessThan(answerAt);
    expect(answerAt).toBeLessThan(optimalAt);
  });

  it("calls out the required conditions a slot doesn't cover", () => {
    render(<BranchTable branches={slot.branches} roundType="dsa" />);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("long_silence");
    expect(note).toHaveTextContent("bug_in_code");
    expect(note).not.toHaveTextContent("stuck,");
  });

  it("uses the behavioural family for hiring-manager rounds", () => {
    render(<BranchTable branches={[{ condition: "only_we", action: "probe_deeper", say: "What did you do?" }]} roundType="hiring-manager" />);
    expect(screen.getByText("Behavioural and HR conditions · 1")).toBeInTheDocument();
  });
});
