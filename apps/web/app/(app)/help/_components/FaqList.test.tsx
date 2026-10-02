import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FaqList } from "./FaqList";

const ITEMS = [
  { question: "Is interview-ready a certification?", answer: "No." },
  { question: "Do I need GitHub or LeetCode?", answer: "No. A resume is enough to start." },
];

describe("FaqList", () => {
  it("starts collapsed and opens each answer independently", async () => {
    const user = userEvent.setup();
    render(<FaqList items={ITEMS} />);
    const [first, second] = screen.getAllByRole("button");
    expect(first).toHaveAttribute("aria-expanded", "false");

    await user.click(first);
    await user.click(second);
    expect(first).toHaveAttribute("aria-expanded", "true");
    expect(second).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: ITEMS[1].question })).toHaveTextContent(ITEMS[1].answer);

    await user.click(first);
    expect(first).toHaveAttribute("aria-expanded", "false");
  });

  it("numbers each question with a decorative Q.nn index left out of its name", () => {
    render(<FaqList items={ITEMS} />);
    expect(screen.getByText("Q.01")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Q.02")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: ITEMS[0].question })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ITEMS[1].question })).toBeInTheDocument();
  });
});
