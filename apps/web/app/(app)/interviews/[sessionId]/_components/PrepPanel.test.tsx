import { describe, expect, it } from "vitest";
import { friendlySteps } from "./PrepPanel";

describe("friendlySteps", () => {
  it("folds run stages into the seven candidate-facing steps", () => {
    const steps = friendlySteps([
      { id: "context", state: "done", elapsedMs: 900 },
      { id: "selection", state: "done", elapsedMs: 300 },
      { id: "answer_keys", state: "active", elapsedMs: null },
      { id: "policies", state: "done", elapsedMs: 5 },
      { id: "validate", state: "pending", elapsedMs: null },
    ]);
    expect(steps.map((s) => s.label)).toEqual([
      "Reading the job description", "Choosing your questions", "Preparing the interviewer's notes", "Meeting your interviewer",
      "Tailoring the interview to you", "Planning the conversation", "Final checks",
    ]);
    expect(steps.map((s) => s.state)).toEqual(["done", "done", "active", "pending", "pending", "pending", "pending"]);
    expect(steps[0]!.elapsedMs).toBe(900);
  });

  it("shows the first step as starting before any run is readable, and a failed stage as failed", () => {
    expect(friendlySteps([])[0]!.state).toBe("active");
    expect(friendlySteps([{ id: "playbooks", state: "failed", elapsedMs: null }])[5]!.state).toBe("failed");
  });
});
