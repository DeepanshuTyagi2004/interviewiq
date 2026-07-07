import type { RunLogEntry, RunStepStatus } from "@/features/observability";
import type { TranscriptEntry } from "@/features/interview-live/session/types";

export type AgentSessionStatus =
  | "running" | "awaiting_input" | "completed" | "failed" | "abandoned" | "aborted";

export interface AgentStep {
  name: string;
  status: RunStepStatus;               // pending|running|ok|failed|skipped
  llm_label: string | null;
  started_at: string | null;           // ISO-8601 (ai-service _now_iso(), proxied 1:1)
  finished_at: string | null;          // ISO-8601
  duration_ms: number | null;
  detail: Record<string, unknown>;
}
export interface AgentTurn {
  index: number;
  kind: "opening" | "main" | "silence";
  candidate_text: string | null;
  artifact_present_this_turn: boolean;
  artifact_available: boolean;
  steps: AgentStep[];
  started_at: string | null;           // ISO-8601
  finished_at: string | null;          // ISO-8601
  duration_ms: number | null;
  elapsed_s_at_turn: number;
}
export interface AgentSession {
  run_id: string;
  pipeline: "interview_agent";
  label: string;
  status: AgentSessionStatus;
  plan_summary: Record<string, unknown>;
  current_turn: number;
  current_step: string | null;
  turns: AgentTurn[];
  transcript: TranscriptEntry[];
  result: unknown | null;
  ended_reason: string | null;
  error: { step?: string; type?: string; message?: string } | null;
  started_at: string;                   // ISO-8601
  finished_at: string | null;           // ISO-8601
  _logs: RunLogEntry[];
  last_seq: number;
}
export interface AgentSessionSummary {
  run_id: string; label: string; status: AgentSessionStatus;
  started_at: string; finished_at: string | null; turn_count: number;  // ISO-8601
}
export interface SubmitTurnBody {
  text?: string;
  artifact?: { kind: string; content: string } | null;
  advance_seconds?: number;
  silence?: boolean;
}
