import { describe, it, expect } from "vitest";
import type { AgentTurn } from "@/features/agent-diagnostics";
import { PIPELINE_EDGES, PIPELINE_STEPS, STEP_STATUS_CLASS, stepsToNodes } from "./stepStatusColor";

function makeTurn(steps: AgentTurn["steps"]): AgentTurn {
  return {
    index: 0,
    kind: "main",
    candidate_text: null,
    artifact_present_this_turn: false,
    artifact_available: false,
    steps,
    started_at: null,
    finished_at: null,
    duration_ms: null,
    elapsed_s_at_turn: 0,
  };
}

function makeStep(name: string, status: AgentTurn["steps"][number]["status"]): AgentTurn["steps"][number] {
  return { name, status, llm_label: null, started_at: null, finished_at: null, duration_ms: null, detail: {} };
}

describe("stepsToNodes", () => {
  it("produces one node per fixed pipeline step, in order", () => {
    const nodes = stepsToNodes(makeTurn([]));
    expect(nodes.map((n) => n.id)).toEqual([...PIPELINE_STEPS]);
  });

  it("reflects a present step's status onto its node", () => {
    const turn = makeTurn([makeStep("stt", "ok"), makeStep("classify", "failed")]);
    const nodes = stepsToNodes(turn);
    expect(nodes.find((n) => n.id === "stt")?.data.status).toBe("ok");
    expect(nodes.find((n) => n.id === "classify")?.data.status).toBe("failed");
  });

  it("maps a step absent from the turn to idle", () => {
    const turn = makeTurn([makeStep("stt", "ok")]);
    const nodes = stepsToNodes(turn);
    expect(nodes.find((n) => n.id === "scope")?.data.status).toBe("idle");
    expect(nodes.find((n) => n.id === "tts")?.data.status).toBe("idle");
  });

  it("handles a null turn by marking every step idle", () => {
    const nodes = stepsToNodes(null);
    expect(nodes.every((n) => n.data.status === "idle")).toBe(true);
  });

  it("gives every node a distinct fixed x position in a horizontal row", () => {
    const nodes = stepsToNodes(makeTurn([]));
    const xs = nodes.map((n) => n.position.x);
    expect(new Set(xs).size).toBe(xs.length);
    expect(nodes.every((n) => n.position.y === 0)).toBe(true);
  });
});

describe("PIPELINE_EDGES", () => {
  it("connects each consecutive pair of fixed steps", () => {
    expect(PIPELINE_EDGES).toHaveLength(PIPELINE_STEPS.length - 1);
    PIPELINE_EDGES.forEach((edge, i) => {
      expect(edge.source).toBe(PIPELINE_STEPS[i]);
      expect(edge.target).toBe(PIPELINE_STEPS[i + 1]);
    });
  });
});

describe("STEP_STATUS_CLASS", () => {
  const STATUSES = ["idle", "pending", "running", "ok", "failed", "skipped"] as const;

  it("styles every node status, including idle", () => {
    for (const s of STATUSES) expect(STEP_STATUS_CLASS[s]).toBeTruthy();
  });

  it("keeps the semantics: brand = running, destructive = failed, ink = done, faint = idle/skipped", () => {
    expect(STEP_STATUS_CLASS.running).toContain("border-brand");
    expect(STEP_STATUS_CLASS.failed).toContain("border-destructive");
    expect(STEP_STATUS_CLASS.ok).toContain("border-foreground");
    expect(STEP_STATUS_CLASS.idle).toContain("text-faint");
    expect(STEP_STATUS_CLASS.skipped).toContain("text-faint");
  });

  it("uses token classes only — no raw hex colours", () => {
    for (const s of STATUSES) expect(STEP_STATUS_CLASS[s]).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});
