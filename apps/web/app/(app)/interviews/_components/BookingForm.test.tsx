import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JdSummary } from "@/features/jobs";
import type { CreateInterviewSessionRequest } from "@/features/interview";

// Use vi.hoisted so the mocks are available when vi.mock factories run.
const { mutateMock, toastSuccess, toastError } = vi.hoisted(() => ({
  mutateMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

const SAMPLE_JDS: JdSummary[] = [
  {
    id: "jd-1",
    company: "google",
    companyName: "Google",
    role: "Software Engineer",
    level: "L4",
    title: "Software Engineer",
    specialization: "Backend",
    dataConfidence: null,
    dataAvailability: "rich",
  },
];

// Mock the jobs hook so the role <select> has a deterministic option to pick.
vi.mock("@/features/jobs", () => ({
  useJds: () => ({ data: SAMPLE_JDS, isLoading: false }),
}));

// Mock the interview hook: capture mutate so we can assert the request body it was called with.
vi.mock("@/features/interview", () => ({
  useCreateSession: () => ({ mutate: mutateMock, isPending: false }),
}));

// Mock sonner so the success/error toast calls don't require a real Toaster.
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

import { BookingForm } from "./BookingForm";

describe("BookingForm", () => {
  beforeEach(() => {
    mutateMock.mockClear();
    toastSuccess.mockClear();
    toastError.mockClear();
  });

  it("renders a mode toggle with Start now and Schedule for later options", () => {
    render(<BookingForm />);

    expect(screen.getByRole("radio", { name: /start now/i })).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: /schedule for later/i }),
    ).toBeInTheDocument();
  });

  it("calls create.mutate with a near-now scheduledAt and a timezone on Start now", async () => {
    const user = userEvent.setup();
    render(<BookingForm />);

    // "now" is the default mode — no need to toggle it explicitly.
    await user.selectOptions(
      screen.getByRole("combobox", { name: /job description/i }),
      "jd-1",
    );
    await user.click(screen.getByRole("button", { name: /^start now$/i }));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    const body = mutateMock.mock.calls[0]![0] as CreateInterviewSessionRequest;

    expect(body.jobDescriptionId).toBe("jd-1");
    expect(body.roundType).toBeUndefined();
    expect(typeof body.timezone).toBe("string");
    expect(body.timezone.length).toBeGreaterThan(0);

    const scheduledAtMs = new Date(body.scheduledAt).getTime();
    const deltaMs = scheduledAtMs - Date.now();
    expect(deltaMs).toBeGreaterThan(0);
    expect(deltaMs).toBeLessThan(2 * 60_000);
  });
});
