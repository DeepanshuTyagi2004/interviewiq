import type { DotState } from "@/components/hud";
import { NODE_ORDER, type NodeName } from "@/lib/constants/research";
import type { AdminCompany, ResearchItem, ResearchItemStatus, ResearchRunStatus, ResearchSpan } from "./types";

export type CompanyResearchStatus =
  | "never_researched" | "queued" | "researching" | "awaiting_review" | "published" | "update_pending" | "failed";

export const COMPANY_STATUS_META: Record<CompanyResearchStatus, { label: string; dot: DotState }> = {
  never_researched: { label: "Never researched", dot: "idle" },
  queued: { label: "Queued", dot: "idle" },
  researching: { label: "Researching", dot: "live" },
  awaiting_review: { label: "Awaiting review", dot: "warn" },
  update_pending: { label: "Published · update pending review", dot: "warn" },
  published: { label: "Published", dot: "active" },
  failed: { label: "Failed", dot: "error" },
};

/** Where a company is in research, from its latest run and its latest draft (spec §9.1 Companies). */
export function companyResearchStatus(company: AdminCompany): CompanyResearchStatus {
  const research = company.research;
  const last = research?.lastStatus;
  if (last === "queued") return "queued";
  if (last === "running" || last === "paused") return "researching";
  if (last === "failed") return "failed";
  if (research?.latestDraftStatus === "pending_review") return company.publishedAt ? "update_pending" : "awaiting_review";
  if (company.publishedAt) return "published";
  return "never_researched";
}

export const RUN_STATUS_DOT: Record<ResearchRunStatus, DotState> = {
  queued: "idle", running: "live", pausing: "live", paused: "warn", stopping: "live",
  stopped: "idle", completed: "active", failed: "error",
};

export const ITEM_STATUS_DOT: Record<ResearchItemStatus, DotState> = {
  queued: "idle", running: "live", paused: "warn", done: "active", failed: "error", skipped: "idle", cancelled: "idle",
};

export const SPAN_STATUS_DOT: Record<ResearchSpan["status"], DotState> = {
  running: "live", ok: "active", error: "error", cancelled: "idle",
};

const ACTIVE: ReadonlySet<ResearchRunStatus> = new Set(["queued", "running", "pausing", "paused", "stopping"]);

export function isRunActive(status: ResearchRunStatus): boolean {
  return ACTIVE.has(status);
}

/** Which run controls apply (mirrors the ai-service's transition rules). */
export function runControls(status: ResearchRunStatus | undefined, pending = false) {
  if (pending) return { start: false, pause: false, resume: false, stop: false };
  return {
    start: !status || !isRunActive(status),
    pause: status === "queued" || status === "running",
    resume: status === "paused",
    stop: status === "queued" || status === "running" || status === "pausing" || status === "paused",
  };
}

export type NodeState = "idle" | "running" | "ok" | "error";

export function nodeStates(item: Pick<ResearchItem, "nodes"> | undefined): Array<{ name: NodeName; state: NodeState }> {
  return NODE_ORDER.map((name) => {
    const s = item?.nodes?.[name]?.status;
    return { name, state: s === "running" || s === "ok" || s === "error" ? s : "idle" };
  });
}
