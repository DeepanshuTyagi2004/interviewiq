import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScoreTiles } from "./ScoreTiles";

describe("ScoreTiles", () => {
  it("shows the interview score and both ranks — no profile score", () => {
    render(<ScoreTiles />);
    const tiles = screen.getAllByRole("listitem");
    expect(tiles.map((t) => within(t).getByText(/score|rank/i).textContent)).toEqual([
      "Interview score",
      "College rank",
      "Global rank",
    ]);
    expect(screen.queryByText("Profile score")).not.toBeInTheDocument();
  });

  it("spans the interview score across the phone grid so no tile sits alone", () => {
    render(<ScoreTiles />);
    const [interview] = screen.getAllByRole("listitem");
    expect(interview).toHaveClass("col-span-2", "lg:col-span-1");
  });

  it("never shows a number until scoring exists", () => {
    render(<ScoreTiles />);
    for (const tile of screen.getAllByRole("listitem")) {
      expect(within(tile).getByText("—")).toHaveAttribute("aria-hidden", "true");
      expect(within(tile).getByText("Not available yet")).toHaveClass("sr-only");
    }
  });
});
