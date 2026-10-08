import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ProfileResponse } from "@/features/profile";
import { SourceSignalCards } from "./SourceSignalCards";

const base: ProfileResponse = {
  user: { name: "Asha", headline: "Engineer" },
  sources: [
    { source: "GITHUB", connected: true },
    { source: "LEETCODE", connected: true },
  ],
  notable: [],
  mostUsedSkills: [],
  provenance: [],
  fragments: {},
};

const complete: ProfileResponse = {
  ...base,
  fragments: {
    github: {
      login: "asha-dev",
      name: "Asha Rao",
      avatarUrl: "",
      joinedYear: 2020,
      publicRepos: 18,
      contributions: { lastYear: 236, weeks: [[0, 1]] },
      languages: [{ name: "TypeScript", pct: 72, bytes: 720 }],
      externalPRs: 7,
      topRepos: [],
    },
    leetcode: {
      username: "asha_codes",
      country: "India",
      solved: { easy: 40, medium: 25, hard: 5, total: 70 },
      byTopic: [
        { topic: "Arrays", count: 20 },
        { topic: "Graphs", count: 8 },
      ],
      contest: { attended: 4, rating: 1510, globalRanking: 0, totalParticipants: 0, topPercent: 0 },
      recentActivity: { last30Days: 3, preferredLanguage: "typescript" },
    },
  },
};

describe("SourceSignalCards", () => {
  it("renders separate GitHub and LeetCode source cards with their factual signals", () => {
    render(<SourceSignalCards profile={complete} />);

    const github = screen.getByRole("region", { name: "GitHub profile" });
    const leetcode = screen.getByRole("region", { name: "LeetCode profile" });
    expect(within(github).getByText("Connected")).toBeInTheDocument();
    expect(within(github).getByText("18")).toBeInTheDocument();
    expect(within(github).getByText("236")).toBeInTheDocument();
    expect(within(github).getByText("7")).toBeInTheDocument();
    expect(within(github).getByText("TypeScript")).toBeInTheDocument();
    expect(within(leetcode).getByText("70")).toBeInTheDocument();
    expect(within(leetcode).getByText("1,510")).toBeInTheDocument();
    expect(within(leetcode).getByLabelText("2 topics covered")).toBeInTheDocument();
    expect(within(leetcode).getByLabelText("Easy: 40 solved")).toHaveAttribute("style", expect.stringContaining("--color-lc-easy"));
    expect(within(leetcode).getByLabelText("Medium: 25 solved")).toHaveAttribute("style", expect.stringContaining("--color-lc-medium"));
    expect(within(leetcode).getByLabelText("Hard: 5 solved")).toHaveAttribute("style", expect.stringContaining("--color-lc-hard"));
  });

  it("keeps missing fragments honest instead of showing zero-valued signals", () => {
    render(<SourceSignalCards profile={{ ...base, sources: [] }} />);

    expect(screen.getByRole("region", { name: "GitHub profile" })).toHaveTextContent("Not connected");
    expect(screen.getByRole("region", { name: "GitHub profile" })).toHaveTextContent("Connect GitHub");
    expect(screen.getByRole("region", { name: "LeetCode profile" })).toHaveTextContent("Not connected");
    expect(screen.getByRole("region", { name: "LeetCode profile" })).toHaveTextContent("Connect LeetCode");
  });

  it("labels partial LeetCode data and uses em dashes for unavailable optional stats", () => {
    render(
      <SourceSignalCards
        profile={{
          ...base,
          fragments: {
            leetcode: {
              solved: { easy: 2, medium: 0, hard: 0 },
              byTopic: [],
              contest: null,
              partial: true,
            },
          },
        }}
      />,
    );

    const card = screen.getByRole("region", { name: "LeetCode profile" });
    expect(within(card).getAllByText("Partial data")).toHaveLength(2);
    expect(within(card).getByRole("status")).toHaveTextContent("could not be imported");
    expect(within(card).getByText("—")).toBeInTheDocument();
    expect(within(card).getByLabelText("0 topics covered")).toBeInTheDocument();
  });

  it("does not ask a connected source to be connected again when its snapshot is missing", () => {
    render(<SourceSignalCards profile={base} />);
    expect(screen.getByRole("region", { name: "GitHub profile" })).toHaveTextContent("data is unavailable");
    expect(screen.getByRole("region", { name: "LeetCode profile" })).toHaveTextContent("data is unavailable");
  });
});
