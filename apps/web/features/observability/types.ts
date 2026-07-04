/**
 * Shared types for the admin pipeline-observability consoles (résumé parse, interview-prep).
 * These mirror the ai-service keyed run store's snapshot shape, proxied 1:1 by the backend.
 */

export type RunStepStatus = "pending" | "running" | "ok" | "failed" | "skipped";

export type RunStep = {
  name: string;
  status: RunStepStatus;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  /** Full-transparency, per-step payload (prompt, raw response, extracted text, final JSON, …). */
  detail: Record<string, unknown>;
};

export type RunLogEntry = {
  seq: number;
  ts: string;
  level: string;
  message: string;
};

export type RunStatus = "running" | "completed" | "failed";

export type RunError = {
  step?: string;
  type?: string;
  message?: string;
};

/** One pipeline run — the shape both consoles poll. `result` is the pipeline's final artifact. */
export type RunSnapshot = {
  run_id: string;
  pipeline: string;
  source: string;
  label: string;
  status: RunStatus;
  current_step: string | null;
  steps: RunStep[];
  result: unknown | null;
  error: RunError | null;
  started_at: string | null;
  finished_at: string | null;
  logs: RunLogEntry[];
  last_seq: number;
};

export type RunSummary = {
  run_id: string;
  pipeline: string;
  source: string;
  label: string;
  status: RunStatus;
  started_at: string | null;
  finished_at: string | null;
  step_count: number;
};

export const isTerminal = (status: RunStatus | undefined): boolean =>
  status === "completed" || status === "failed";
