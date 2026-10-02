import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { IdentityCard } from "./IdentityCard";

describe("IdentityCard", () => {
  it("is a notched HUD card named 'About you'", () => {
    render(<IdentityCard name="Asha Rao" subtitle="B.Tech CSE · RVCE · 2027" skills={[]} />);
    const card = screen.getByRole("region", { name: "About you" });
    expect(card).toHaveClass("hud-card", "hud-notch");
    expect(within(card).getByText("Asha Rao")).toBeInTheDocument();
  });

  it("shows the interview score as an honest dash, never a number — and no profile score", () => {
    render(<IdentityCard name="Asha Rao" subtitle={null} skills={[]} />);
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
        name={null}
        subtitle={null}
        skills={[{ skill: "Python", evidence: "GitHub 52%, resume claimed", source: "GITHUB" }]}
      />,
    );
    expect(screen.getByText("Your name")).toBeInTheDocument();
    expect(screen.getByText("Most-used skills")).toBeInTheDocument();
    expect(screen.getByText("(from GitHub)")).toHaveClass("sr-only");
  });
});
