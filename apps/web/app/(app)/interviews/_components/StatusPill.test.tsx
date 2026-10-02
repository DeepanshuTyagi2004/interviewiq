import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SessionStatus } from "@/features/interview";
import { StatusPill, statusDotState } from "./StatusPill";

describe("statusDotState", () => {
  it.each([
    ["LIVE_IN_PROGRESS", "live"],
    ["PREP_QUEUED", "live"],
    ["PREP_READY", "active"],
    ["PREP_FAILED", "error"],
    ["COMPLETED", "idle"],
    ["SCHEDULED", "idle"],
    ["ABORTED_TECHNICAL", "idle"],
    ["SOMETHING_NEW", "idle"],
  ])("%s → %s", (status, expected) => {
    expect(statusDotState(status as SessionStatus)).toBe(expected);
  });
});

describe("StatusPill", () => {
  it("shows the status label next to a dot that pulses only while something runs", () => {
    const { container, rerender } = render(<StatusPill status="LIVE_IN_PROGRESS" />);
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(container.querySelector("[data-motion]")).not.toBeNull();

    rerender(<StatusPill status="PREP_READY" />);
    expect(container.querySelector("[data-motion]")).toBeNull();

    rerender(<StatusPill status="COMPLETED" />);
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(container.querySelector("[data-motion]")).toBeNull();
  });
});
