import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ComingSoon } from "./ComingSoon";

describe("ComingSoon", () => {
  it("shows the title as the page heading and the default hint", () => {
    render(<ComingSoon title="Practice" />);
    expect(screen.getByRole("heading", { level: 1, name: "Practice" })).toBeInTheDocument();
    expect(screen.getByText("Coming soon")).toBeInTheDocument();
    expect(screen.getByText("This screen is on the way.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("uses a custom hint and shows a link when href and cta are given", () => {
    render(<ComingSoon title="Loops" hint="Coming with Module 02." href="/jobs" cta="Browse roles" />);
    expect(screen.getByText("Coming with Module 02.")).toBeInTheDocument();
    expect(screen.queryByText("This screen is on the way.")).toBeNull();
    expect(screen.getByRole("link", { name: "Browse roles" })).toHaveAttribute("href", "/jobs");
  });
});
