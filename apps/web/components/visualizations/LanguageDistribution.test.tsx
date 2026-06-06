import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LanguageDistribution } from "./LanguageDistribution";
import type { GithubLanguage } from "@/features/profile";

const LANGS: GithubLanguage[] = [
  { name: "TypeScript", pct: 48, bytes: 1234567 },
  { name: "Python", pct: 32, bytes: 800000 },
  { name: "Go", pct: 20, bytes: 500000 },
];

describe("LanguageDistribution", () => {
  // These names come from the component's own <ul> legend rendered OUTSIDE
  // Recharts (Recharts renders 0x0 in jsdom), so the assertions are reliable.
  it("renders a legend entry per language", () => {
    render(<LanguageDistribution languages={LANGS} />);
    expect(screen.getByText("TypeScript")).toBeInTheDocument();
    expect(screen.getByText("Python")).toBeInTheDocument();
    expect(screen.getByText("Go")).toBeInTheDocument();
  });

  it("shows an empty state when there is no data", () => {
    render(<LanguageDistribution languages={[]} />);
    expect(screen.getByText(/no language data/i)).toBeInTheDocument();
  });

  it("contains no scoring or ranking language", () => {
    const { container } = render(<LanguageDistribution languages={LANGS} />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/score|rank|grade|top \d+%|percentile|better than|above average/i);
  });
});
