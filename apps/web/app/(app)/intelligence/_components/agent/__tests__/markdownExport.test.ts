import { test, expect } from "vitest";
import { turnToMarkdown } from "../markdownExport";
import type { AgentTurn } from "@/features/agent-diagnostics";

test("turnToMarkdown includes decisions, prompts and branch reason", () => {
  const turn: AgentTurn = {
    index: 1, kind: "main", candidate_text: "my answer",
    artifact_present_this_turn: false, artifact_available: false,
    started_at: "2026-01-01T00:00:00Z", finished_at: "2026-01-01T00:00:01Z", duration_ms: 1000, elapsed_s_at_turn: 60,
    steps: [
      { name: "classify", status: "ok", llm_label: "iv-classify", started_at: "2026-01-01T00:00:00Z", finished_at: "2026-01-01T00:00:01Z",
        duration_ms: 100, detail: { decision: "answer" } },
      { name: "route", status: "ok", llm_label: null, started_at: "2026-01-01T00:00:00Z", finished_at: "2026-01-01T00:00:01Z",
        duration_ms: 10, detail: { decision: "MOVE_ON", branch_reason: "answer adequate -> move on / wrap" } },
    ],
  };
  const md = turnToMarkdown(turn);
  expect(md).toContain("Turn 1");
  expect(md).toContain("classify");
  expect(md).toContain("answer");
  expect(md).toContain("MOVE_ON");
  expect(md).toContain("answer adequate");
});

test("turnToMarkdown renders a reasoning block for a step with detail.thought, and a system block for prompt_system", () => {
  const turn: AgentTurn = {
    index: 2, kind: "main", candidate_text: "my answer",
    artifact_present_this_turn: false, artifact_available: false,
    started_at: "2026-01-01T00:00:00Z", finished_at: "2026-01-01T00:00:01Z", duration_ms: 500, elapsed_s_at_turn: 90,
    steps: [
      {
        name: "route", status: "ok", llm_label: "iv-route",
        started_at: "2026-01-01T00:00:00Z", finished_at: "2026-01-01T00:00:01Z", duration_ms: 50,
        detail: {
          prompt_system: "you are the interviewer persona",
          prompt_user: "candidate said X",
          raw_response: '{"decision":"MOVE_ON"}',
          thought: "the answer covered the key tradeoffs, moving on",
        },
      },
    ],
  };
  const md = turnToMarkdown(turn);
  expect(md).toContain("- system:");
  expect(md).toContain("you are the interviewer persona");
  expect(md).toContain("- reasoning:");
  expect(md).toContain("the answer covered the key tradeoffs, moving on");
});
