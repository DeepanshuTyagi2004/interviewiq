import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiagnosticsTab } from "./DiagnosticsTab";
import { DIAGNOSTICS_FIXTURE, scoringWrapper } from "@/features/profile-scoring/test-fixtures";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client/client", () => ({ apiFetch: (...args: unknown[]) => fetchMock(...args) }));

describe("DiagnosticsTab", () => {
  beforeEach(() => { fetchMock.mockReset(); fetchMock.mockResolvedValue(DIAGNOSTICS_FIXTURE); });
  it("explicitly marks rubrics absent from a legacy six-level configuration", async () => {
    const weights = { ...DIAGNOSTICS_FIXTURE.methodology.weights };
    delete weights.intern;
    delete weights.distinguished;
    fetchMock.mockResolvedValue({ ...DIAGNOSTICS_FIXTURE, methodology: { ...DIAGNOSTICS_FIXTURE.methodology, weights } });
    render(<DiagnosticsTab />, { wrapper: scoringWrapper().wrapper });
    await screen.findByText("Snapshot replay");
    expect(screen.getByText("Intern: Rubric unavailable in this configuration")).toBeInTheDocument();
    expect(screen.getByText("Distinguished: Rubric unavailable in this configuration")).toBeInTheDocument();
    expect(screen.getByText("SDE I: coding 100%")).toBeInTheDocument();
  });
  it("loads bounded statuses, replay metadata and weekly receipts without a write", async () => {
    render(<DiagnosticsTab />, { wrapper: scoringWrapper().wrapper });
    expect(await screen.findByText("Snapshot replay")).toBeInTheDocument();
    const checks = screen.getByRole("region", { name: "Diagnostic check results" });
    for (const status of ["pass", "fail", "warning", "untested"]) expect(within(checks).getByText(status)).toBeInTheDocument();
    expect(screen.getByText("input-hash")).toBeInTheDocument();
    expect(screen.getByText("config-hash")).toBeInTheDocument();
    expect(screen.getByText("Next due")).toBeInTheDocument();
    expect(screen.getByText(/Intern: coding 100%/)).toBeInTheDocument();
    expect(screen.getByText(/SDE I: coding 100%/)).toBeInTheDocument();
    expect(screen.getByText(/Distinguished: strategy 100%/)).toBeInTheDocument();
    expect(screen.getByText(/No provider credentials or raw private source payloads/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/intelligence/diagnostics");
    expect(fetchMock.mock.calls.every(([, options]) => !options)).toBe(true);
  });

  it("inspects an explicit user and offers no recalculation writes", async () => {
    const user = userEvent.setup();
    render(<DiagnosticsTab />, { wrapper: scoringWrapper().wrapper });
    await screen.findByText("Snapshot replay");
    const userId = "550e8400-e29b-41d4-a716-446655440000";
    await user.type(screen.getByLabelText("User ID (optional)"), userId);
    await user.click(screen.getByRole("button", { name: "Inspect" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/v1/intelligence/diagnostics?userId=${userId}`));
    // Recalculation moved to the Live profile tab, which streams every step.
    expect(screen.queryByRole("button", { name: /Recalculate/ })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.every(([, options]) => !options)).toBe(true);
  });

  it("exposes retry on read errors", async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValue(DIAGNOSTICS_FIXTURE);
    render(<DiagnosticsTab />, { wrapper: scoringWrapper().wrapper });
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load diagnostics");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Snapshot replay")).toBeInTheDocument();
  });
});
