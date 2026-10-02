import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InterviewScoreCard, RanksCard } from "./ScoreTiles";

describe("InterviewScoreCard / RanksCard", () => {
  it("shows the interview score and both ranks — no profile score", () => {
    render(
      <>
        <InterviewScoreCard />
        <RanksCard />
      </>,
    );
    expect(screen.getByRole("region", { name: "Interview score" })).toBeInTheDocument();
    const ranks = screen.getByRole("region", { name: "Ranks" });
    expect(within(ranks).getByText("College rank")).toBeInTheDocument();
    expect(within(ranks).getByText("Global rank")).toBeInTheDocument();
    expect(screen.queryByText("Profile score")).not.toBeInTheDocument();
  });

  it("never shows a number until scoring exists", () => {
    render(
      <>
        <InterviewScoreCard />
        <RanksCard />
      </>,
    );
    const dashes = screen.getAllByText("—");
    expect(dashes).toHaveLength(3);
    for (const dash of dashes) expect(dash).toHaveAttribute("aria-hidden", "true");
    for (const sr of screen.getAllByText("Not available yet")) expect(sr).toHaveClass("sr-only");
  });
});
