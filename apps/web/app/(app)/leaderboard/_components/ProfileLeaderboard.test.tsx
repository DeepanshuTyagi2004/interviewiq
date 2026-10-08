import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileLeaderboard } from "./ProfileLeaderboard";
import { PROFILE_SCORE_FIXTURE, scoringWrapper } from "@/features/profile-scoring/test-fixtures";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client/client", () => ({ apiFetch: (...args: unknown[]) => fetchMock(...args) }));

describe("ProfileLeaderboard", () => {
  beforeEach(() => { fetchMock.mockReset(); });
  it("requests and displays only the selected engineering-level cohort", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation((path: string) => {
      if (!path.includes("profile-leaderboard?")) return Promise.resolve(PROFILE_SCORE_FIXTURE);
      const level = new URLSearchParams(path.split("?")[1]).get("level");
      return Promise.resolve({ level, algorithmVersion: "profile-beta-v1", week: "2026-09-28", total: 5, entries: [{ rank: 1, displayName: `${level} peer`, score: 80, confidence: 75, percentile: 100 }] });
    });
    render(<ProfileLeaderboard />, { wrapper: scoringWrapper().wrapper });
    expect(await screen.findByText("sde2 peer")).toBeInTheDocument();
    expect(screen.getByText(/Your profile is hidden by default/)).toBeInTheDocument();
    // Percentile, not confidence (75): v5 has no confidence weighting, so the board doesn't show it.
    expect(screen.getByText("100.0%")).toBeInTheDocument();
    expect(screen.queryByText("75%")).not.toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Leaderboard engineering level" }));
    expect(screen.getAllByRole("option")).toHaveLength(8);
    expect(screen.getByRole("option", { name: "Intern" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Distinguished" })).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Staff" }));
    expect(await screen.findByText("staff peer")).toBeInTheDocument();
    expect(screen.queryByText("sde2 peer")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/profile-leaderboard?level=staff&limit=25");
    expect(fetchMock.mock.calls.filter(([path]) => path.includes("profile-leaderboard")).every(([path]) => path.includes("level="))).toBe(true);
  });

  it("provides retry and an honest empty small-cohort state without fabricated rows", async () => {
    const user = userEvent.setup();
    let failed = true;
    fetchMock.mockImplementation((path: string) => {
      if (!path.includes("profile-leaderboard?")) return Promise.resolve({ ...PROFILE_SCORE_FIXTURE, current: null });
      return failed ? Promise.reject(new Error("Unavailable")) : Promise.resolve({ level: "fresher", algorithmVersion: "v1", week: "2026-09-28", total: 0, entries: [] });
    });
    render(<ProfileLeaderboard />, { wrapper: scoringWrapper().wrapper });
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the leaderboard");
    failed = false;
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(/No eligible Fresher cohort/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("does not display a mismatched response as the chosen level", async () => {
    fetchMock.mockImplementation((path: string) => Promise.resolve(path.includes("profile-leaderboard?") ? { level: "principal", algorithmVersion: "v1", week: "2026-09-28", total: 5, entries: [{ rank: 1, displayName: "Wrong cohort", score: 99, confidence: 100, percentile: 100 }] } : PROFILE_SCORE_FIXTURE));
    render(<ProfileLeaderboard />, { wrapper: scoringWrapper().wrapper });
    await waitFor(() => expect(screen.getByText(/No eligible SDE II cohort/)).toBeInTheDocument());
    expect(screen.queryByText("Wrong cohort")).not.toBeInTheDocument();
  });
});
