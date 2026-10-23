import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProfileScoreCard } from "./ProfileScoreCard";
import { ScoreExplainer } from "./ScoreExplainer";
import { PROFILE_SCORE_FIXTURE, scoringWrapper } from "../test-fixtures";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client/client", () => ({ apiFetch: (...args: unknown[]) => fetchMock(...args) }));

describe("ScoreExplainer", () => {
  beforeEach(() => { fetchMock.mockReset(); fetchMock.mockResolvedValue(PROFILE_SCORE_FIXTURE); });

  it("explains why the score is what it is: each part's weight, part score and contribution", async () => {
    render(<ScoreExplainer />, { wrapper: scoringWrapper().wrapper });
    // ownership: weight 25, part score 80, contributes 20
    expect(await screen.findByText(/Part score 80 \/ 100/)).toBeInTheDocument();
    expect(screen.getAllByText("73 / 100").length).toBeGreaterThan(0);
    // a part with no evidence counts as 0 and says so
    expect(screen.getByText(/No evidence yet, counts as 0/)).toBeInTheDocument();
  });

  it("covers how it is calculated, how to raise it and what it is not", async () => {
    render(<ScoreExplainer />, { wrapper: scoringWrapper().wrapper });
    await screen.findByText(/Part score 80 \/ 100/);
    expect(screen.getByRole("heading", { name: "How it is calculated" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "How to raise it" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Weights by level" })).toBeInTheDocument();
    expect(screen.getAllByText(/not a validated hiring assessment/i).length).toBeGreaterThan(0);
    // the part with the most points left leads the "gain the most" list
    expect(screen.getByText("Where you can gain the most")).toBeInTheDocument();
  });

  it("says there is no score yet, and that it is not a zero, when nothing has evidence", async () => {
    fetchMock.mockResolvedValue({ ...PROFILE_SCORE_FIXTURE, current: null, history: [] });
    render(<ScoreExplainer />, { wrapper: scoringWrapper().wrapper });
    expect(await screen.findByText(/There is no score yet/)).toBeInTheDocument();
    expect(screen.getByText(/This is not a zero/)).toBeInTheDocument();
  });
});

describe("Profile score card link", () => {
  it("links to the score explainer page", async () => {
    fetchMock.mockReset(); fetchMock.mockResolvedValue(PROFILE_SCORE_FIXTURE);
    render(<ProfileScoreCard />, { wrapper: scoringWrapper().wrapper });
    const link = await screen.findByRole("link", { name: /How your score is calculated/ });
    expect(link).toHaveAttribute("href", "/profile/score");
  });
});
