import { test, expect } from "vitest";
import { turnToMarkdown } from "../markdownExport";
import type { AgentTurn } from "@/features/agent-diagnostics";

test("turnToMarkdown includes decisions, prompts and branch reason", () => {
  const turn: AgentTurn = {
    index: 1, kind: "main", candidate_text: "my answer",
    artifact_present_this_turn: false, artifact_available: false,
    started_at: 0, finished_at: 1, duration_ms: 1000, elapsed_s_at_turn: 60,
    steps: [
      { name: "classify", status: "ok", llm_label: "iv-classify", started_at: 0, finished_at: 1,
        duration_ms: 100, detail: { decision: "answer" } },
      { name: "route", status: "ok", llm_label: null, started_at: 0, finished_at: 1,
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
