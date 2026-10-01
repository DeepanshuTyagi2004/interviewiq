import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LeetCodeTopics } from "./LeetCodeTopics";

const TOPICS = Array.from({ length: 10 }, (_, i) => ({ topic: `Topic ${i}`, count: (i + 1) * 3 }));

describe("LeetCodeTopics", () => {
  it("lists the busiest topics first, then reveals the rest on request", async () => {
    const user = userEvent.setup();
    render(<LeetCodeTopics byTopic={TOPICS} />);
    const list = screen.getByRole("list", { name: /by topic/i });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(8);
    expect(rows[0]).toHaveTextContent("Topic 9");

    await user.click(screen.getByRole("button", { name: /show all 10 topics/i }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(10);
  });

  it("shows an empty state without data and never compares", () => {
    const { container, rerender } = render(<LeetCodeTopics byTopic={[]} />);
    expect(screen.getByText(/no leetcode topic data/i)).toBeInTheDocument();
    rerender(<LeetCodeTopics byTopic={TOPICS} />);
    expect(container.textContent ?? "").not.toMatch(/score|rank|grade|percentile|better than|above average/i);
  });
});
