import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ProfileDiagnosticsResponse, ProfileScoreResponse, ProfileScoreSnapshot } from "./types";

export function scoringWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return { client, wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}

export const SCORE_FIXTURE: ProfileScoreSnapshot = {
  id: "score-1", algorithmVersion: "profile-beta-v1", configHash: "config-hash", inputHash: "input-hash", asOf: "2026-10-04T10:00:00Z",
  calculatedAt: "2026-10-04T10:00:00Z", week: "2026-09-28", status: "scored", score: 73, confidence: 80, coverage: 70, level: "sde2",
  classification: { declaredLevel: null, assessedLevel: "sde1", confidence: 75, reasons: ["Ownership evidence"], warnings: [] },
  components: [
    { id: "ownership", label: "Engineering ownership", weight: 25, score: 80, contribution: 20, status: "available", evidenceIds: ["evidence-1"] },
    { id: "architecture", label: "Architecture and trade-offs", weight: 15, score: null, contribution: null, status: "missing", evidenceIds: [] },
  ],
  evidence: [{ id: "evidence-1", source: "RESUME", path: "experience[0].bullets[0]", claim: "Owned a service migration", value: "migration", confidence: 75, observedAt: null, verification: "self_reported", recencyFactor: 1 }],
  sources: [{ source: "RESUME", status: "available", fetchedAt: "2026-10-03T10:00:00Z", ageDays: 1, contentHash: "resume-hash" }],
  warnings: ["Self-reported evidence is provisional"], eligibility: { eligible: false, reasons: ["Cohort too small"] }, rank: null, percentile: null, cohortSize: 2,
};
export const PROFILE_SCORE_FIXTURE: ProfileScoreResponse = { current: SCORE_FIXTURE, history: [SCORE_FIXTURE], settings: { declaredLevel: null, leaderboardOptIn: false },
  assessment: { available: true, inProgress: false, limit: 3, remaining: 3, nextAvailableAt: null } };
export const DIAGNOSTICS_FIXTURE: ProfileDiagnosticsResponse = {
  checkedAt: "2026-10-04T10:00:00Z", checks: [
    { id: "replay", label: "Snapshot replay", status: "pass", detail: "Frozen input is reproducible" },
    { id: "sources", label: "Source freshness", status: "warning", detail: "One stale source" },
    { id: "provider", label: "Provider access", status: "untested", detail: "No live provider request made" },
    { id: "cohort", label: "Cohort eligibility", status: "fail", detail: "Too few eligible peers" },
  ], score: PROFILE_SCORE_FIXTURE,
  jobs: { enabled: true, status: "idle", lastStartedAt: null, lastCompletedAt: null, nextDueAt: "2026-10-05T00:00:00Z", lastError: null, processed: 0, failed: 0 },
  methodology: { version: "profile-beta-v1", beta: true, weights: { intern: { coding: 100 }, fresher: { coding: 100 }, sde1: { coding: 100 }, sde2: { ownership: 100 }, sde3: { architecture: 100 }, staff: { cross_team: 100 }, principal: { strategy: 100 }, distinguished: { strategy: 100 } }, normalizers: { easyCap: 100 }, thresholds: { minimumCoverage: 60, minimumConfidence: 60, minimumCohort: 5 } },
};
