import { describe, expect, it } from "vitest";
import { OUTLINE_PILL } from "@/components/observability/status";
import type { AgentSessionStatus } from "@/features/agent-diagnostics";
import type { RunStatus } from "@/features/intelligence";
import {
  BRIEF_STATUS_PILL,
  CONFIDENCE_PILL,
  DIFFICULTY_PILL,
  FUNNEL_ORDER,
  FUNNEL_STATUS,
  MATCH_TIER_META,
  PROVENANCE_META,
  RUN_STATUS_DOT,
  SESSION_DOT,
  lookFor,
} from "./pills";

const RAW_COLOUR = /#[0-9a-f]{3,8}\b|\b(emerald|amber|sky|teal|violet|purple|green|red|yellow)-\d/i;

describe("intelligence pill looks", () => {
  it("marks live work with brand and failures with alert", () => {
    expect(BRIEF_STATUS_PILL.running.tone).toBe("brand");
    expect(BRIEF_STATUS_PILL.failed.tone).toBe("alert");
    expect(FUNNEL_STATUS.extract_failed.look.tone).toBe("alert");
  });

  it("gives the most-trusted provenance the heaviest look", () => {
    expect(PROVENANCE_META.evidence_backed.look.tone).toBe("ink");
    expect(PROVENANCE_META.process_guide.look.tone).toBe("soft");
    expect(PROVENANCE_META.template.look.className).toContain("outline-dashed");
    expect(CONFIDENCE_PILL.high.tone).toBe("ink");
    expect(DIFFICULTY_PILL.hard.tone).toBe("ink");
  });

  it("orders every funnel status it labels", () => {
    expect(new Set(FUNNEL_ORDER)).toEqual(new Set(Object.keys(FUNNEL_STATUS)));
  });

  it("uses only token classes, no raw palette colours", () => {
    const looks = [
      ...Object.values(BRIEF_STATUS_PILL),
      ...Object.values(CONFIDENCE_PILL),
      ...Object.values(DIFFICULTY_PILL),
      ...Object.values(FUNNEL_STATUS).map((m) => m.look),
      ...Object.values(MATCH_TIER_META).map((m) => m.look),
      ...Object.values(PROVENANCE_META).map((m) => m.look),
    ];
    for (const look of looks) expect(look.className ?? "").not.toMatch(RAW_COLOUR);
  });
});

describe("run + session status dots", () => {
  it.each<[RunStatus, string]>([
    ["running", "live"],
    ["completed", "active"],
    ["failed", "error"],
    ["cancelled", "idle"],
    ["idle", "idle"],
  ])("maps an ingestion run that is %s to the %s dot", (status, dot) => {
    expect(RUN_STATUS_DOT[status]).toBe(dot);
  });

  it.each<[AgentSessionStatus, string]>([
    ["running", "live"],
    ["awaiting_input", "live"],
    ["completed", "active"],
    ["failed", "error"],
    ["abandoned", "idle"],
    ["aborted", "idle"],
  ])("maps an agent session that is %s to the %s dot", (status, dot) => {
    expect(SESSION_DOT[status]).toBe(dot);
  });

  it("pulses (live) only for work that is really in flight", () => {
    const liveRuns = Object.entries(RUN_STATUS_DOT).filter(([, d]) => d === "live").map(([s]) => s);
    expect(liveRuns).toEqual(["running"]);
    const liveSessions = Object.entries(SESSION_DOT).filter(([, d]) => d === "live").map(([s]) => s);
    expect(liveSessions.sort()).toEqual(["awaiting_input", "running"]);
  });
});

describe("lookFor", () => {
  it("returns the mapped look, or the fallback for unknown and missing keys", () => {
    expect(lookFor(CONFIDENCE_PILL, "high", OUTLINE_PILL)).toBe(CONFIDENCE_PILL.high);
    expect(lookFor(CONFIDENCE_PILL, "bogus", OUTLINE_PILL)).toBe(OUTLINE_PILL);
    expect(lookFor(CONFIDENCE_PILL, null, OUTLINE_PILL)).toBe(OUTLINE_PILL);
    expect(lookFor(CONFIDENCE_PILL, "toString", OUTLINE_PILL)).toBe(OUTLINE_PILL);
  });
});
