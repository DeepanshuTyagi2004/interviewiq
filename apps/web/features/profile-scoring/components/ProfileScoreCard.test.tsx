import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IdentityCard } from "@/app/(app)/profile/_components/IdentityCard";
import { ProfileScoreCard, ProfileScoreReadout } from "./ProfileScoreCard";
import { PROFILE_SCORE_FIXTURE, SCORE_FIXTURE, scoringWrapper } from "../test-fixtures";
import { snapshotDelta } from "./ScoreBreakdown";
import { SCORE_KEYS } from "../constants";
import { PROFILE_QUERY_KEYS } from "@/lib/constants/profile";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client/client", () => ({ apiFetch: (...args: unknown[]) => fetchMock(...args) }));

describe("ProfileScoreCard", () => {
  beforeEach(() => { fetchMock.mockReset(); fetchMock.mockResolvedValue(PROFILE_SCORE_FIXTURE); });
  it("shows the plain header readout from the shared score query", async () => {
    render(<ProfileScoreReadout />, { wrapper: scoringWrapper().wrapper });
    expect(await screen.findByLabelText("Profile score: 73")).toBeInTheDocument();
    expect(screen.getByText("73")).toBeInTheDocument();
  });
  it("reads the current profile level separately from a frozen scoring snapshot", async () => {
    fetchMock.mockResolvedValue({ ...PROFILE_SCORE_FIXTURE, settings: { declaredLevel: "distinguished", leaderboardOptIn: false } });
    render(<ProfileScoreCard />, { wrapper: scoringWrapper().wrapper });
    await screen.findByLabelText("Profile score: 73");
    expect(screen.getByText("Distinguished")).toBeInTheDocument();
    expect(screen.getAllByText("SDE II").length).toBeGreaterThan(0);
    expect(screen.queryByText("Use evidence-assessed level")).not.toBeInTheDocument();
  });
  it("keeps unknown beta profile evidence separate from the interview placeholder", async () => {
    fetchMock.mockResolvedValue({ ...PROFILE_SCORE_FIXTURE, current: null, history: [] });
    render(<><IdentityCard skills={[]} /><ProfileScoreCard /></>, { wrapper: scoringWrapper().wrapper });
    await screen.findByLabelText("Profile score: Unknown");
    expect(screen.getByText(/Unknown does not mean zero/)).toBeInTheDocument();
    expect(screen.getByText(/Not a validated hiring assessment/)).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "About you" })).getByText("Interview score")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Opt in to level leaderboard" })).not.toBeChecked();
    expect(screen.getByText(/Hidden from the leaderboard by default/)).toBeInTheDocument();
  });

  it("renders an evidenced zero as a real score and offers retry after a failed read", async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValue({ ...PROFILE_SCORE_FIXTURE, current: { ...SCORE_FIXTURE, score: 0 } });
    render(<ProfileScoreCard />, { wrapper: scoringWrapper().wrapper });
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load profile score");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByLabelText("Profile score: 0")).toBeInTheDocument();
    expect(screen.queryByText(/Not enough evidence/)).not.toBeInTheDocument();
  });

  it("renders user-facing metrics without exposing scoring internals", async () => {
    render(<ProfileScoreCard />, { wrapper: scoringWrapper().wrapper });
    await screen.findByLabelText("Profile score: 73");
    // v5 has no confidence weighting, so confidence (80 in the fixture) is not shown; coverage is.
    expect(screen.queryByText("80%")).not.toBeInTheDocument();
    expect(screen.getByText("70%")).toBeInTheDocument();
    expect(screen.getByText("SDE II")).toBeInTheDocument();
    expect(screen.getByText("Rank / percentile")).toBeInTheDocument();
    expect(screen.getByText(/Cohort too small/)).toBeInTheDocument();
    expect(screen.queryByText("profile-beta-v1")).not.toBeInTheDocument();
    expect(screen.queryByText(/Calculated|Week 2026/)).not.toBeInTheDocument();
    expect(screen.queryByText("Level assessment reasoning")).not.toBeInTheDocument();
    expect(screen.queryByText("Evidence & component breakdown")).not.toBeInTheDocument();
    expect(screen.queryByText("Score history")).not.toBeInTheDocument();
    expect(screen.queryByText("Ownership evidence")).not.toBeInTheDocument();
    expect(screen.queryByText("/ 100")).not.toBeInTheDocument();
  });

  it("saves participation and links to the single profile-level editor", async () => {
    const user = userEvent.setup();
    render(<ProfileScoreCard />, { wrapper: scoringWrapper().wrapper });
    await screen.findByLabelText("Profile score: 73");
    await user.click(screen.getByRole("switch", { name: "Opt in to level leaderboard" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/v1/users/me/profile-score/settings", { method: "PATCH", json: { leaderboardOptIn: true } }));
    expect(screen.getByRole("link", { name: "Edit engineering level in Profile details" })).toHaveAttribute("href", "/profile#profile-level");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, options]) => options?.json?.declaredLevel !== undefined)).toBe(false);
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);
  });

  it("recalculates explicitly, shows pending and inline failure, then permits retry", async () => {
    const user = userEvent.setup();
    let reject!: (reason: Error) => void;
    fetchMock.mockImplementation((_path, options) => options?.method === "POST" ? new Promise((_resolve, fail) => { reject = fail; }) : Promise.resolve(PROFILE_SCORE_FIXTURE));
    render(<ProfileScoreCard />, { wrapper: scoringWrapper().wrapper });
    await screen.findByLabelText("Profile score: 73");
    await user.click(screen.getByRole("button", { name: "Recalculate profile score" }));
    expect(await screen.findByText(/Waiting for a new snapshot/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recalculating…" })).toBeDisabled();
    reject(new Error("Failed"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not recalculate profile score");
    expect(screen.getByRole("button", { name: "Recalculate profile score" })).toBeEnabled();
  });

  it("refreshes score reads when source data refreshes without triggering a mutation", async () => {
    const { client, wrapper } = scoringWrapper();
    render(<ProfileScoreCard />, { wrapper });
    await screen.findByLabelText("Profile score: 73");
    const before = fetchMock.mock.calls.length;
    client.setQueryData(PROFILE_QUERY_KEYS.profile, { provenance: [{ fragmentHash: "new" }] });
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
    const afterRefresh = fetchMock.mock.calls.length;
    client.setQueryData(PROFILE_QUERY_KEYS.profile, { provenance: [{ fragmentHash: "new" }] });
    expect(fetchMock.mock.calls.length).toBe(afterRefresh);
    expect(client.getQueryData(SCORE_KEYS.me)).toBeTruthy();
    expect(fetchMock.mock.calls.every(([, options]) => !options)).toBe(true);
  });
});

describe("snapshotDelta", () => {
  it("shows weekly movement under the same rubric but withholds deltas across levels or configurations", () => {
    const previous = { ...SCORE_FIXTURE, id: "previous", score: 70, rank: 4, percentile: 20 };
    const current = { ...SCORE_FIXTURE, rank: 2, percentile: 80 };
    expect(snapshotDelta(current, previous)).toEqual({ score: 3, rank: 2 });
    expect(snapshotDelta(current, { ...previous, level: "staff" })).toBeNull();
    expect(snapshotDelta(current, { ...previous, algorithmVersion: "v2" })).toBeNull();
    expect(snapshotDelta(current, { ...previous, configHash: "other" })).toBeNull();
    expect(snapshotDelta(current, { ...previous, week: "2026-09-21" })).toEqual({ score: 3, rank: 2 });
    expect(snapshotDelta(current, { ...previous, cohortSize: 10 })).toEqual({ score: 3, rank: 2 });
    expect(snapshotDelta(current, { ...previous, percentile: null })).toEqual({ score: 3, rank: null });
  });
});
