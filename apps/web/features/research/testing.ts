/** Builders for research UI tests. Not imported by app code. */
import type { AdminCompany, ResearchEvent, ResearchItem, ResearchRun, ResearchSpan } from "./types";

export const RUN_ID = "a".repeat(32);

export function makeCompany(over: Partial<AdminCompany> = {}): AdminCompany {
  return {
    id: "00000000-0000-4000-8000-000000000001", name: "Meesho", slug: "meesho", website: null, aliases: [],
    status: "active", origin: "admin", tier: null, publishedVersion: null, publishedAt: null,
    createdAt: "2026-10-01T00:00:00Z", research: null, ...over,
  };
}

export function makeRun(over: Partial<ResearchRun> = {}): ResearchRun {
  return {
    run_id: RUN_ID, trigger: "admin", mode: "live", scope: "all", company_ids: ["c-meesho"], status: "running",
    control: "none", pause_reason: null, requested_by: null,
    counters: { total: 2, queued: 1, running: 1, paused: 0, done: 0, failed: 0, skipped: 0, cancelled: 0 },
    budget: { exa_used: 3, exa_cap: 400, llm_used: 2, llm_cap: 2000, tokens_in: 1200, tokens_out: 300 },
    last_seq: 10, created_at: "2026-10-02T10:00:00+00:00", started_at: "2026-10-02T10:00:01+00:00",
    finished_at: null, error: null, pipeline_version: "research-v1", ...over,
  };
}

export function makeItem(over: Partial<ResearchItem> = {}): ResearchItem {
  return {
    run_id: RUN_ID, company_id: "c-meesho", company_name: "Meesho", company_slug: "meesho", position: 0,
    status: "running", attempts: 1, current_node: "resolve", last_node: null, nodes: { resolve: { status: "running" } },
    draft_id: null, error: null, started_at: null, finished_at: null, ...over,
  };
}

export function makeSpan(over: Partial<ResearchSpan> & { span_id: string }): ResearchSpan {
  return {
    parent_id: null, run_id: RUN_ID, company_id: null, node: null, kind: "node", name: "resolve", status: "ok",
    started_at: "2026-10-02T10:00:01+00:00", ended_at: null, duration_ms: 120, attrs: {}, input_ref: null,
    output_ref: null, error: null, ...over,
  };
}

export function makeEvent(over: Partial<ResearchEvent> = {}): ResearchEvent {
  return {
    run_id: RUN_ID, seq: 1, ts: "2026-10-02T10:00:05+00:00", level: "info", level_rank: 20, type: "log",
    message: "hello", span_id: null, company_id: null, node: null, ...over,
  };
}
