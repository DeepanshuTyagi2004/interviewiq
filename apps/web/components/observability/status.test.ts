import { describe, expect, it } from "vitest";
import type { RunStepStatus } from "@/features/observability";
import { STEP_DOT, STEP_PILL, formatDuration, prettyStepName } from "./status";

const STATUSES: RunStepStatus[] = ["pending", "running", "ok", "failed", "skipped"];
const RAW_COLOUR = /#[0-9a-f]{3,8}\b|\b(emerald|amber|sky|teal|violet|purple|green|red|yellow)-\d/i;

describe("step status looks", () => {
  it("covers every step status with a label, a pill tone and a dot", () => {
    for (const s of STATUSES) {
      expect(STEP_PILL[s].label).toBeTruthy();
      expect(STEP_PILL[s].tone).toBeTruthy();
      expect(STEP_DOT[s]).toBeTruthy();
    }
  });

  it("keeps the semantics: running is brand, failed is destructive, ok is ink", () => {
    expect(STEP_PILL.running.tone).toBe("brand");
    expect(STEP_PILL.failed.tone).toBe("alert");
    expect(STEP_DOT.running).toContain("bg-brand");
    expect(STEP_DOT.failed).toContain("bg-destructive");
    expect(STEP_DOT.ok).toContain("bg-foreground");
  });

  it("uses only token classes, no raw palette colours", () => {
    for (const s of STATUSES) {
      expect(STEP_DOT[s]).not.toMatch(RAW_COLOUR);
      expect(STEP_PILL[s].className ?? "").not.toMatch(RAW_COLOUR);
    }
  });
});

describe("formatters", () => {
  it("pretty-prints step names", () => {
    expect(prettyStepName("extract_text")).toBe("Extract Text");
    expect(prettyStepName("stt")).toBe("Stt");
  });

  it("formats durations as ms under a second, else one-decimal seconds", () => {
    expect(formatDuration(42)).toBe("42ms");
    expect(formatDuration(6120)).toBe("6.1s");
  });
});
