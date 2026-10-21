import { describe, expect, it } from "vitest";
import type { InterviewSession } from "@/features/interview";
import { dayMonth, outcomeChip, recentSessions, scoreText, sessionHref, sessionPill, shortDate, upcomingSessions, weekSessions, whenLabel } from "./sessions";

function session(partial: Partial<InterviewSession>): InterviewSession {
  return {
    id: partial.id ?? "s",
    candidateId: "c",
    jobDescriptionId: "j",
    company: "meesho",
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
    roundMinutes: 45,
    passMark: null,
    score: null,
    outcome: null,
    verdict: null,
    retakeAfter: null,
    evaluationStatus: null,
    endReason: null,
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

const NOW = new Date(2026, 9, 18, 18, 0);

describe("whenLabel", () => {
  it("counts calendar days, not hours", () => {
    expect(whenLabel("2026-10-18T23:30:00", NOW)).toBe("Today");
    expect(whenLabel("2026-10-19T00:30:00", NOW)).toBe("Tomorrow");
    expect(whenLabel("2026-10-22T10:00:00", NOW)).toBe("in 4 days");
    expect(whenLabel("2026-12-02T10:00:00", NOW)).toBe("2 Dec");
  });
});

describe("weekSessions", () => {
  it("keeps the next seven days, drops cancelled, soonest first", () => {
    const list = [
      session({ id: "later", scheduledAt: "2026-10-30T10:00:00" }),
      session({ id: "b", scheduledAt: "2026-10-20T10:00:00" }),
      session({ id: "a", scheduledAt: "2026-10-18T09:00:00" }),
      session({ id: "gone", status: "CANCELLED", scheduledAt: "2026-10-19T10:00:00" }),
      session({ id: "past", scheduledAt: "2026-10-17T10:00:00" }),
    ];
    expect(weekSessions(list, NOW).map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("outcomeChip", () => {
  const base = { status: "COMPLETED" as const, outcome: null, retakeAfter: null, evaluationStatus: null };
  it("labels passed and not scored", () => {
    expect(outcomeChip({ ...base, outcome: "passed" }, NOW)).toEqual({ label: "Passed", tone: "passed" });
    expect(outcomeChip({ ...base, outcome: "unscorable" }, NOW).label).toBe("Not scored");
  });
  it("shows the retake date while the cooldown runs, else Retake now", () => {
    expect(outcomeChip({ ...base, outcome: "below_pass", retakeAfter: "2026-10-25T10:00:00" }, NOW).label).toBe("Retake 25 Oct");
    expect(outcomeChip({ ...base, outcome: "below_pass", retakeAfter: null }, NOW).label).toBe("Retake now");
    expect(outcomeChip({ ...base, outcome: "auto_fail", retakeAfter: "2026-10-01T10:00:00" }, NOW).label).toBe("Retake now");
  });
  it("covers rounds with no outcome yet", () => {
    expect(outcomeChip({ ...base, status: "ABORTED_TECHNICAL" }, NOW).label).toBe("Interrupted");
    expect(outcomeChip({ ...base, evaluationStatus: "evaluating" }, NOW).label).toBe("Grading");
    expect(outcomeChip(base, NOW).label).toBe("Not scored");
  });
});

describe("scoreText and dayMonth", () => {
  it("formats one decimal, null when ungraded", () => {
    expect(scoreText(7.8)).toBe("7.8");
    expect(scoreText(6)).toBe("6.0");
    expect(scoreText(null)).toBeNull();
    expect(dayMonth("2026-10-12T10:00:00")).toBe("12 Oct");
  });
});
