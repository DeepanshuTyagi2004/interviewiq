import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { IdentityCard } from "./IdentityCard";

describe("IdentityCard", () => {
  it("is a region named 'About you'", () => {
    render(<IdentityCard skills={[]} />);
    const card = screen.getByRole("region", { name: "About you" });
    expect(within(card).getByText("Interview score")).toBeInTheDocument();
  });

  it("shows the interview score as an honest dash, never a number — and no profile score", () => {
    render(<IdentityCard skills={[]} />);
    expect(screen.queryByText("Profile score")).not.toBeInTheDocument();
    const tile = screen.getByText("Interview score").parentElement!;
    const dash = within(tile).getByText("—");
    expect(dash).toHaveAttribute("aria-hidden", "true");
    // Screen readers hear the sr-only text once; the visible note is hidden from them.
    const notes = within(tile).getAllByText("Not scored yet");
    expect(notes.filter((n) => n.classList.contains("sr-only"))).toHaveLength(1);
    expect(notes.filter((n) => n.getAttribute("aria-hidden") === "true")).toHaveLength(1);
    expect(tile.textContent).not.toMatch(/\d/);
  });

  it("lists most-used skills with their source, when the summary has run", () => {
    render(
      <IdentityCard
        skills={[{ skill: "Python", evidence: "GitHub 52%, resume claimed", source: "GITHUB" }]}
      />,
    );
    expect(screen.getByText("Most-used skills")).toBeInTheDocument();
    expect(screen.getByText("(from GitHub)")).toHaveClass("sr-only");
  });
});
