import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { SummaryCard } from "./SummaryCard";

describe("SummaryCard", () => {
  it("marks each at-a-glance bullet with a decorative mono chevron", () => {
    render(
      <SummaryCard
        atAGlance={["Final-year CSE student at RVCE", "412 problems solved on LeetCode"]}
        notable={[]}
      />,
    );
    const card = screen.getByRole("region", { name: "At a glance" });
    const items = within(card).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    for (const item of items) {
      const marker = within(item).getByText("›");
      expect(marker).toHaveAttribute("aria-hidden", "true");
      expect(marker).toHaveClass("font-mono");
    }
    expect(within(items[1]).getByText("412 problems solved on LeetCode")).toBeInTheDocument();
  });

  it("tags each notable item with its source", () => {
    render(<SummaryCard atAGlance={[]} notable={[{ text: "Smart India Hackathon finalist", source: "RESUME" }]} />);
    const item = screen.getByText("Smart India Hackathon finalist").closest("li")!;
    expect(within(item).getByText("Source:")).toHaveClass("sr-only");
    expect(within(item).getByText("Resume")).toBeInTheDocument();
  });

  it("shows the empty note on the shared empty block when there's nothing yet", () => {
    render(<SummaryCard atAGlance={[]} notable={[]} />);
    const card = screen.getByRole("region", { name: "At a glance" });
    expect(within(card).getByText("No data")).toHaveAttribute("aria-hidden", "true");
    expect(within(card).getByText("No highlights yet.")).toBeInTheDocument();
    expect(
      within(card).getByText("They’re written from your resume and connected accounts once they’ve been read."),
    ).toBeInTheDocument();
  });
});
