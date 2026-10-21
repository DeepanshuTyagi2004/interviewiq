import { describe, expect, it } from "vitest";
import {
  bookingHref,
  companyLabel,
  isFinished,
  isJoinable,
  levelLabel,
  parseBookingPrefill,
  partitionSessions,
  roundLabel,
  sessionSteps,
  statusMeta,
  STATUS_META,
} from "./presentation";
import type { SessionStatus } from "./types";

const ALL_STATUSES: SessionStatus[] = [
  "SCHEDULED",
  "PREP_QUEUED",
  "PREP_READY",
  "PREP_FAILED",
  "LIVE_IN_PROGRESS",
  "COMPLETED",
  "ABORTED_TECHNICAL",
];

describe("interview presentation helpers", () => {
  it("labels rounds and levels, passing unknown values through", () => {
    expect(roundLabel("system-design")).toBe("System Design");
    expect(roundLabel("mystery")).toBe("mystery");
    expect(levelLabel("sde1")).toBe("SDE I");
    expect(levelLabel("L4")).toBe("L4");
  });

  it("prefers the company name and falls back to the slug", () => {
    expect(companyLabel({ company: "meesho", companyName: "Meesho" })).toBe("Meesho");
    expect(companyLabel({ company: "meesho", companyName: null })).toBe("meesho");
  });

  it("has a pill for every session status, with a spinner only while preparing", () => {
    for (const s of ALL_STATUSES) expect(STATUS_META[s].label.length).toBeGreaterThan(0);
    expect(ALL_STATUSES.filter((s) => STATUS_META[s].pending)).toEqual(["PREP_QUEUED"]);
    expect(statusMeta("PREP_FAILED").tone).toBe("alert");
    expect(statusMeta("NOT_A_STATUS")).toEqual(STATUS_META.SCHEDULED);
  });

  it("classifies joinable and finished sessions", () => {
    expect(ALL_STATUSES.filter((status) => isJoinable({ status, liveAvailable: true }))).toEqual(["PREP_READY", "LIVE_IN_PROGRESS"]);
    // While the live interviewer is unavailable a ready round can't be joined; a live one still can.
    expect(ALL_STATUSES.filter((status) => isJoinable({ status, liveAvailable: false }))).toEqual(["LIVE_IN_PROGRESS"]);
    expect(ALL_STATUSES.filter((status) => isFinished({ status }))).toEqual(["COMPLETED", "ABORTED_TECHNICAL"]);
  });

  it("splits sessions into upcoming (soonest first) and past (latest first)", () => {
    const at = (d: string) => `2026-10-${d}T10:00:00Z`;
    const { upcoming, past } = partitionSessions([
      { status: "SCHEDULED", scheduledAt: at("05") },
      { status: "COMPLETED", scheduledAt: at("01") },
      { status: "PREP_READY", scheduledAt: at("02") },
      { status: "ABORTED_TECHNICAL", scheduledAt: at("03") },
    ]);
    expect(upcoming.map((s) => s.scheduledAt)).toEqual([at("02"), at("05")]);
    expect(past.map((s) => s.scheduledAt)).toEqual([at("03"), at("01")]);
  });

  it("builds the booking link with optional prefill", () => {
    expect(bookingHref()).toBe("/interviews");
    expect(bookingHref({ jd: "jd-1", round: "lld" })).toBe("/interviews?jd=jd-1&round=lld");
  });
});

describe("parseBookingPrefill", () => {
  it("keeps a well-formed JD id and a known round", () => {
    expect(parseBookingPrefill({ jd: "3f0c1a2b-0000-4000-8000-000000000001", round: "system-design" })).toEqual({
      jobDescriptionId: "3f0c1a2b-0000-4000-8000-000000000001",
      roundType: "system-design",
    });
  });

  it("normalises the round's case and takes the first of repeated params", () => {
    expect(parseBookingPrefill({ jd: ["jd-1", "jd-2"], round: "DSA" })).toEqual({ jobDescriptionId: "jd-1", roundType: "dsa" });
  });

  it("drops unknown rounds and malformed ids without failing", () => {
    expect(parseBookingPrefill({ jd: "<script>", round: "online-assessment" })).toEqual({});
    expect(parseBookingPrefill({ jd: "", round: "" })).toEqual({});
    expect(parseBookingPrefill({})).toEqual({});
    expect(parseBookingPrefill({ round: "behavioural" })).toEqual({ roundType: "behavioural" });
  });
});

describe("sessionSteps", () => {
  const states = (status: SessionStatus) => sessionSteps(status).map((s) => s.state);

  it("walks the lifecycle from booked to debrief", () => {
    expect(states("SCHEDULED")).toEqual(["done", "upcoming", "upcoming", "upcoming"]);
    expect(states("PREP_QUEUED")).toEqual(["done", "current", "upcoming", "upcoming"]);
    expect(states("PREP_READY")).toEqual(["done", "done", "current", "upcoming"]);
    expect(states("LIVE_IN_PROGRESS")).toEqual(["done", "done", "current", "upcoming"]);
    expect(states("COMPLETED")).toEqual(["done", "done", "done", "current"]);
  });

  it("marks the failing step for failed prep and interrupted rounds", () => {
    expect(states("PREP_FAILED")).toEqual(["done", "failed", "upcoming", "upcoming"]);
    expect(states("ABORTED_TECHNICAL")).toEqual(["done", "done", "failed", "current"]);
  });

  it("words the debrief step from how grading went, without claiming a score", () => {
    const note = (e?: "evaluating" | "ready" | "failed" | "legacy" | null) => sessionSteps("COMPLETED", e).find((s) => s.key === "debrief");
    expect(note("evaluating")?.note).toMatch(/being graded/i);
    expect(note("ready")).toMatchObject({ state: "done", note: "Your report is ready" });
    expect(note("failed")?.state).toBe("failed");
    expect(note("legacy")?.note).toMatch(/not scored/i);
  });
});
