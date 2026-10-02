import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NotableCard } from "./NotableCard";

describe("NotableCard", () => {
  it("is the 'Notable' card — there is no at-a-glance section", () => {
    render(<NotableCard notable={[{ text: "412 LeetCode problems solved", source: "LEETCODE" }]} />);
    const card = screen.getByRole("region", { name: "Notable" });
    expect(within(card).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByText(/at a glance/i)).not.toBeInTheDocument();
  });

  it("tags each notable item with its source", () => {
    render(<NotableCard notable={[{ text: "Smart India Hackathon finalist", source: "RESUME" }]} />);
    const item = screen.getByText("Smart India Hackathon finalist").closest("li")!;
    expect(within(item).getByText("Source:")).toHaveClass("sr-only");
    expect(within(item).getByText("Resume")).toBeInTheDocument();
  });

  it("shows the empty note on the shared empty block when there's nothing yet", () => {
    render(<NotableCard notable={[]} />);
    const card = screen.getByRole("region", { name: "Notable" });
    expect(within(card).getByText("No data")).toHaveAttribute("aria-hidden", "true");
    expect(within(card).getByText("No highlights yet.")).toBeInTheDocument();
    expect(
      within(card).getByText("They’re written from your resume and connected accounts once they’ve been read."),
    ).toBeInTheDocument();
  });
});
