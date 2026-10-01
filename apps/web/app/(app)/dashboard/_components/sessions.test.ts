import { describe, expect, it } from "vitest";
import type { InterviewSession } from "@/features/interview";
import { recentSessions, sessionHref, sessionPill, shortDate, upcomingSessions } from "./sessions";

function session(partial: Partial<InterviewSession>): InterviewSession {
  return {
    id: partial.id ?? "s",
    candidateId: "c",
    jobDescriptionId: "j",
    company: "meesho",
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

describe("upcomingSessions", () => {
  it("drops finished sessions and sorts soonest first", () => {
    const list = [
      session({ id: "late", scheduledAt: "2026-10-20T10:00:00" }),
      session({ id: "done", status: "COMPLETED", scheduledAt: "2026-09-01T10:00:00" }),
      session({ id: "soon", scheduledAt: "2026-10-02T10:00:00" }),
      session({ id: "aborted", status: "ABORTED_TECHNICAL" }),
    ];
    expect(upcomingSessions(list).map((s) => s.id)).toEqual(["soon", "late"]);
  });

  it("respects the limit", () => {
    const list = Array.from({ length: 6 }, (_, i) => session({ id: String(i) }));
    expect(upcomingSessions(list, 3)).toHaveLength(3);
  });
});

describe("sessionPill", () => {
  it("shows the date while a session is only scheduled", () => {
    expect(sessionPill(session({ scheduledAt: "2026-10-04T10:00:00" }))).toEqual({ label: "OCT 04", tone: "soft" });
  });

  it("maps prep and live states", () => {
    expect(sessionPill(session({ status: "PREP_READY" })).label).toBe("READY");
    expect(sessionPill(session({ status: "PREP_FAILED" })).tone).toBe("alert");
    expect(sessionPill(session({ status: "LIVE_IN_PROGRESS" })).tone).toBe("ink");
  });
});

describe("shortDate", () => {
  it("formats as upper-case month and padded day", () => {
    expect(shortDate("2026-01-07T09:00:00")).toBe("JAN 07");
  });
});

describe("recentSessions", () => {
  it("keeps finished sessions only, newest first", () => {
    const list = [
      session({ id: "old", status: "COMPLETED", scheduledAt: "2026-08-01T10:00:00" }),
      session({ id: "upcoming", scheduledAt: "2026-10-02T10:00:00" }),
      session({ id: "new", status: "ABORTED_TECHNICAL", scheduledAt: "2026-09-20T10:00:00" }),
    ];
    expect(recentSessions(list).map((s) => s.id)).toEqual(["new", "old"]);
  });
});

describe("sessionHref", () => {
  it("opens the room only once the session is joinable", () => {
    expect(sessionHref(session({ id: "a", status: "PREP_READY" }))).toBe("/interviews/a/live");
    expect(sessionHref(session({ id: "a", status: "LIVE_IN_PROGRESS" }))).toBe("/interviews/a/live");
    expect(sessionHref(session({ id: "a", status: "SCHEDULED" }))).toBe("/interviews");
  });
});
