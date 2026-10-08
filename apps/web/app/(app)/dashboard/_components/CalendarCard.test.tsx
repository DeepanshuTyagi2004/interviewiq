import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { InterviewSession } from "@/features/interview";
import { CalendarCard } from "./CalendarCard";

const NOW = new Date(2026, 9, 2, 18, 0);

function session(partial: Partial<InterviewSession>): InterviewSession {
  return {
    id: "a",
    candidateId: "c",
    jobDescriptionId: "j",
    company: "meesho",
    companyName: "Meesho",
    role: "SDE",
    level: "sde1",
    specialization: "backend",
    roundType: "dsa",
    scheduledAt: "2026-10-04T10:00:00",
    timezone: "Asia/Kolkata",
    status: "SCHEDULED",
    prep: { step: null, steps: [], refreshing: false, preparedAt: null, errorCode: null },
    briefing: null,
    liveAvailable: true,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    ...partial,
  };
}

describe("CalendarCard", () => {
  it("opens on today with nothing scheduled and a way to book", () => {
    render(<CalendarCard sessions={[]} now={NOW} />);
    expect(screen.getByRole("heading", { name: "October 2026" })).toBeInTheDocument();
    expect(screen.getByText(/0 rounds this month/i)).toBeInTheDocument();
    const today = screen.getByRole("button", { name: "Friday, October 2, today" });
    expect(today).toHaveAttribute("aria-pressed", "true");
    expect(today).toHaveAttribute("tabindex", "0");
    expect(screen.getByText("Nothing scheduled")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Book a round" })).toHaveAttribute("href", "/interviews");
  });

  it("only makes the month's own days interactive", () => {
    render(<CalendarCard sessions={[]} now={NOW} />);
    const grid = screen.getByRole("group", { name: "October 2026" });
    expect(within(grid).getAllByRole("button")).toHaveLength(31);
  });

  it("shows a day's rounds when it's selected, and joins a ready one", () => {
    render(
      <CalendarCard
        now={NOW}
        sessions={[session({ id: "r1", status: "PREP_READY" }), session({ id: "r2", scheduledAt: "2026-10-04T15:00:00" })]}
      />,
    );
    expect(screen.getByText(/2 rounds this month/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sunday, October 4, 2 rounds" }));
    const links = screen.getAllByRole("link", { name: /DSA · Meesho SDE I/ });
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/interviews/r1", "/interviews/r2"]);
    expect(screen.getByRole("link", { name: "Enter room" })).toHaveAttribute("href", "/interviews/r1/live");
  });

  it("moves by arrow keys and follows into the next month", () => {
    render(<CalendarCard sessions={[]} now={new Date(2026, 9, 30)} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Friday, October 30, today" }), { key: "ArrowDown" });
    expect(screen.getByRole("heading", { name: "November 2026" })).toBeInTheDocument();
    const moved = screen.getByRole("button", { name: "Friday, November 6" });
    expect(moved).toHaveAttribute("aria-pressed", "true");
    expect(moved).toHaveFocus();
  });

  it("pages months without losing the selected day, and Today returns", () => {
    render(<CalendarCard sessions={[]} now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(screen.getByRole("heading", { name: "November 2026" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sunday, November 1" })).toHaveAttribute("tabindex", "0");
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByRole("heading", { name: "October 2026" })).toBeInTheDocument();
  });
});
