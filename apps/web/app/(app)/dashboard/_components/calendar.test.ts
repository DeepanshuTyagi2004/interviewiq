import { describe, expect, it } from "vitest";
import type { InterviewSession } from "@/features/interview";
import { addDays, addMonths, countInMonth, dayKey, monthGrid, sessionsByDay } from "./calendar";

function session(id: string, scheduledAt: string): InterviewSession {
  return {
    id,
    candidateId: "c",
    jobDescriptionId: "j",
    company: "meesho",
    companyName: "Meesho",
    role: "SDE",
    level: "sde1",
    specialization: "backend",
    roundType: "dsa",
    scheduledAt,
    timezone: "Asia/Kolkata",
    status: "SCHEDULED",
    prep: { step: null, steps: [], refreshing: false, preparedAt: null, errorCode: null },
    briefing: null,
    liveAvailable: true,
    endReason: null,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
  };
}

describe("dayKey", () => {
  it("is the local date, zero-padded", () => {
    expect(dayKey(new Date(2026, 0, 7, 23, 59))).toBe("2026-01-07");
  });
});

describe("addDays / addMonths", () => {
  it("cross month and year boundaries", () => {
    expect(dayKey(addDays(new Date(2026, 9, 31), 1))).toBe("2026-11-01");
    expect(dayKey(addDays(new Date(2026, 0, 1), -1))).toBe("2025-12-31");
    expect(dayKey(addMonths(new Date(2026, 11, 15), 1))).toBe("2027-01-01");
  });
});

describe("monthGrid", () => {
  it("covers six Monday-first weeks around the month", () => {
    const grid = monthGrid(new Date(2026, 9, 2));
    expect(grid).toHaveLength(42);
    expect(grid[0].key).toBe("2026-09-28");
    expect(grid[0].date.getDay()).toBe(1);
    expect(grid[41].key).toBe("2026-11-08");
    expect(grid.filter((d) => d.inMonth)).toHaveLength(31);
    expect(grid.find((d) => d.inMonth)?.key).toBe("2026-10-01");
  });

  it("starts on the 1st when the month opens on a Monday", () => {
    const grid = monthGrid(new Date(2027, 1, 20));
    expect(grid[0].key).toBe("2027-02-01");
    expect(grid[0].inMonth).toBe(true);
  });
});

describe("sessionsByDay / countInMonth", () => {
  const sessions = [
    session("late", "2026-10-04T15:00:00"),
    session("early", "2026-10-04T09:30:00"),
    session("next-month", "2026-11-02T10:00:00"),
  ];

  it("groups by local day in time order", () => {
    const byDay = sessionsByDay(sessions);
    expect(byDay.get("2026-10-04")?.map((s) => s.id)).toEqual(["early", "late"]);
    expect(byDay.get("2026-11-02")?.map((s) => s.id)).toEqual(["next-month"]);
  });

  it("counts only the month's own sessions", () => {
    const byDay = sessionsByDay(sessions);
    expect(countInMonth(byDay, new Date(2026, 9, 1))).toBe(2);
    expect(countInMonth(byDay, new Date(2026, 10, 1))).toBe(1);
    expect(countInMonth(byDay, new Date(2026, 8, 1))).toBe(0);
  });
});
