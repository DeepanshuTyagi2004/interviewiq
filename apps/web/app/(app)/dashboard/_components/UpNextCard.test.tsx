import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { InterviewSession } from "@/features/interview";
import { UpNextCard } from "./UpNextCard";

function session(partial: Partial<InterviewSession>): InterviewSession {
  return {
    id: "a",
    candidateId: "c",
    jobDescriptionId: "j",
    company: "meesho",
    companyName: "Meesho",
    role: "SDE",
    level: "SDE I",
    specialization: "backend",
    roundType: "dsa",
    scheduledAt: "2026-10-04T10:00:00",
    timezone: "Asia/Kolkata",
    status: "SCHEDULED",
    planReady: false,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    ...partial,
  };
}

describe("UpNextCard", () => {
  it("points at the company library when nothing is booked", () => {
    const { container } = render(<UpNextCard session={undefined} />);
    const card = screen.getByRole("region", { name: "Up next" });
    expect(within(card).getByText("No round booked yet")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /browse companies/i })).toHaveAttribute("href", "/jobs");
    expect(container.querySelector("dl")).toBeNull();
  });

  it("shows a booked round as a readout strip with a steady (non-pulsing) dot", () => {
    const { container } = render(<UpNextCard session={session({})} />);
    expect(screen.getByText("BOOKED · OCT 04")).toBeInTheDocument();
    expect(container.querySelector("[data-motion]")).toBeNull();
    const strip = container.querySelector("dl");
    expect(strip).not.toBeNull();
    const terms = Array.from(strip!.querySelectorAll("dt")).map((dt) => dt.textContent);
    expect(terms).toEqual(["Slot", "Level", "Track"]);
    expect(within(strip as HTMLElement).getByText("backend")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view schedule/i })).toHaveAttribute("href", "/interviews");
  });

  it("drops the Track cell without a specialization", () => {
    const { container } = render(<UpNextCard session={session({ specialization: "" })} />);
    const terms = Array.from(container.querySelectorAll("dl dt")).map((dt) => dt.textContent);
    expect(terms).toEqual(["Slot", "Level"]);
  });

  it("shows a ready round with a steady dot and the Enter room action", () => {
    const { container } = render(<UpNextCard session={session({ status: "PREP_READY" })} />);
    expect(screen.getByText("READY TO JOIN")).toBeInTheDocument();
    expect(container.querySelector("[data-motion]")).toBeNull();
    expect(screen.getByRole("link", { name: /enter room/i })).toHaveAttribute("href", "/interviews/a/live");
  });

  it("pulses the dot while prep is running, without offering the room yet", () => {
    const { container } = render(<UpNextCard session={session({ status: "PREP_QUEUED" })} />);
    expect(screen.getByText("PREPARING")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-motion]")).toHaveLength(1);
    expect(screen.getByRole("link", { name: /view schedule/i })).toBeInTheDocument();
  });

  it("pulses the dot for a live round and links into the room", () => {
    const { container } = render(<UpNextCard session={session({ status: "LIVE_IN_PROGRESS" })} />);
    expect(screen.getByText("LIVE NOW")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-motion]")).toHaveLength(1);
    expect(screen.getByRole("link", { name: /enter room/i })).toBeInTheDocument();
  });

  it("marks a failed prep with the error dot, not a pulse", () => {
    const { container } = render(<UpNextCard session={session({ status: "PREP_FAILED" })} />);
    expect(screen.getByText("PREP FAILED")).toBeInTheDocument();
    expect(container.querySelector("[data-motion]")).toBeNull();
    expect(container.querySelector(".bg-destructive")).not.toBeNull();
  });
});
