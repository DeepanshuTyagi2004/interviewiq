import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { InterviewSession, SessionStatus } from "@/features/interview";

const { useSessionMock } = vi.hoisted(() => ({ useSessionMock: vi.fn() }));

vi.mock("@/features/interview", () => ({
  useSession: useSessionMock,
  useRegenerateSession: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { SessionDetail } from "./SessionDetail";

const base: InterviewSession = {
  id: "s1",
  candidateId: "c1",
  jobDescriptionId: "jd-1",
  company: "meesho",
  companyName: "Meesho",
  role: "Software Engineer",
  level: "sde1",
  specialization: "Backend",
  roundType: "dsa",
  scheduledAt: "2026-10-05T10:00:00Z",
  timezone: "Asia/Kolkata",
  status: "SCHEDULED",
  planReady: false,
  createdAt: "2026-10-01T09:00:00Z",
  updatedAt: "2026-10-01T09:00:00Z",
};

function renderAt(status: SessionStatus) {
  useSessionMock.mockReturnValue({ data: { ...base, status }, isLoading: false, isError: false });
  render(<SessionDetail sessionId="s1" />);
  return screen.getByRole("region", { name: "Progress" });
}

describe("SessionDetail progress timeline", () => {
  it("lists the four steps on a rail between them, with their text and state for screen readers", () => {
    const progress = renderAt("PREP_QUEUED");
    const steps = within(progress).getAllByRole("listitem");
    expect(steps).toHaveLength(4);
    expect(progress.querySelectorAll("[data-rail]")).toHaveLength(3);
    expect(within(steps[1]).getByText("Interviewer prepared")).toBeInTheDocument();
    expect(within(steps[1]).getByText("Preparing now")).toBeInTheDocument();
    expect(within(steps[1]).getByText("Now")).toHaveClass("sr-only");
    expect(within(steps[0]).getByText("Done")).toHaveClass("sr-only");
  });

  it.each([
    ["PREP_QUEUED", 1],
    ["LIVE_IN_PROGRESS", 1],
    ["PREP_READY", 0],
    ["COMPLETED", 0],
    ["SCHEDULED", 0],
    ["PREP_FAILED", 0],
  ] as const)("%s: %i pulsing step dot(s), only for a step that's really running", (status, pulsing) => {
    const progress = renderAt(status);
    expect(progress.querySelectorAll("[data-motion]")).toHaveLength(pulsing);
  });
});
