import { cleanText, number } from "./sanitization.js";
import { validTimestamp } from "./adapters.js";
import { aggregateItems } from "./subFeatures.js";
import type { ScoringConfig } from "./types.js";

/**
 * Open-source contribution scoring from merged pull requests to repositories the user does not own
 * (GitHub collector, public repositories only). Everything is read directly from the collector:
 * no LLM. A PR qualifies when the change is non-trivial, so typo/whitespace PRs cannot farm the
 * score. There is no star floor (`ossMinRepoStars` 0): a merged change to any project someone else
 * owns counts; the project's reach is a separate sub-feature. Older configs keep their floor.
 */
export interface MergedPullRequest {
  repo: string;
  stars: number;
  additions: number;
  deletions: number;
  changedFiles: number;
  docsOnly: boolean;
  mergedAt: string | null;
  title: string;
}

export interface OpenSourceMeasure { key: string; value: number; raw: Record<string, unknown> }

const TRIVIAL_TITLE = /\b(?:typo|typos|spelling|whitespace|formatting only|fix (?:a )?link|broken link|readme typo|update readme)\b/i;
/** A docs-only change qualifies only when it is substantial (a real guide, not a one-line fix). */
const DOCS_MINIMUM_LINES = 100;
const MINIMUM_LINES = 10;
const DEPTH_SATURATION_LINES = 1000;
const REACH_SATURATION_STARS = 10_000;
const DISTINCT_PROJECT_SATURATION = 5;

const count = (raw: unknown, max: number) => { const n = number(raw); return n === null || !Number.isInteger(n) || n > max ? null : n; };

export function sanitizeMergedPullRequests(raw: unknown): MergedPullRequest[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 100).flatMap((entry): MergedPullRequest[] => {
    const value = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    const repo = cleanText(value.repo)?.slice(0, 140) ?? null, stars = count(value.stars, 10_000_000);
    const additions = count(value.additions, 10_000_000), deletions = count(value.deletions, 10_000_000), changedFiles = count(value.changedFiles, 100_000);
    if (!repo || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo) || stars === null || additions === null || deletions === null || changedFiles === null) return [];
    return [{ repo, stars, additions, deletions, changedFiles, docsOnly: value.docsOnly === true,
      mergedAt: validTimestamp(value.mergedAt) ? new Date(value.mergedAt).toISOString() : null, title: cleanText(value.title)?.slice(0, 120) ?? "" }];
  }).sort((a, b) => (b.mergedAt ?? "").localeCompare(a.mergedAt ?? "") || a.repo.localeCompare(b.repo) || a.title.localeCompare(b.title));
}

/** Why a PR does or does not count; the reason is shown as evidence. */
export function qualifyPullRequest(pr: MergedPullRequest, config: ScoringConfig): { qualifies: boolean; reason: string } {
  const lines = pr.additions + pr.deletions;
  const floor = config.normalizers.ossMinRepoStars ?? 0;
  if (floor > 0 && pr.stars < floor) return { qualifies: false, reason: `repository below ${floor} stars` };
  if (TRIVIAL_TITLE.test(pr.title) && lines < DOCS_MINIMUM_LINES) return { qualifies: false, reason: "typo/formatting change" };
  if (pr.docsOnly && lines < DOCS_MINIMUM_LINES) return { qualifies: false, reason: "small documentation-only change" };
  if (lines < MINIMUM_LINES && pr.changedFiles < 2) return { qualifies: false, reason: "trivial change" };
  return { qualifies: true, reason: pr.docsOnly ? "substantial documentation" : "code change" };
}

const reach = (stars: number) => 100 * Math.min(1, Math.log10(Math.max(1, stars)) / Math.log10(REACH_SATURATION_STARS));
const depth = (pr: MergedPullRequest) => 100 * Math.min(1, Math.log10(1 + pr.additions + pr.deletions) / Math.log10(DEPTH_SATURATION_LINES));

/**
 * Sub-features over qualifying PRs. Reach and depth use the strongest projects/PRs with diminishing
 * headroom for further ones, so many small PRs cannot outscore one significant contribution.
 */
export function scoreOpenSource(prs: MergedPullRequest[], asOf: string, config: ScoringConfig): { measures: OpenSourceMeasure[]; qualifying: MergedPullRequest[]; excluded: { repo: string; reason: string }[] } {
  const n = config.normalizers, extra = config.v5Policy!.itemAggregation.additionalItemWeights;
  const judged = prs.map((pr) => ({ pr, ...qualifyPullRequest(pr, config) }));
  const qualifying = judged.filter((x) => x.qualifies).map((x) => x.pr);
  const excluded = judged.filter((x) => !x.qualifies).map((x) => ({ repo: x.pr.repo, reason: x.reason }));
  if (!qualifying.length) return { measures: [], qualifying, excluded };
  const byRepo = new Map<string, MergedPullRequest[]>();
  for (const pr of qualifying) byRepo.set(pr.repo, [...(byRepo.get(pr.repo) ?? []), pr]);
  const repos = [...byRepo.entries()].map(([repo, rows]) => ({ repo, stars: Math.max(...rows.map((row) => row.stars)), prs: rows.length })).sort((a, b) => b.stars - a.stars || a.repo.localeCompare(b.repo));
  const measures: OpenSourceMeasure[] = [
    { key: "merged_contributions", value: 100 * (1 - Math.pow(0.5, qualifying.length / n.ossContributionHalfCount!)), raw: { qualifyingMergedPRs: qualifying.length, excluded: excluded.length } },
    { key: "project_reach", value: aggregateItems(repos.map((repo) => reach(repo.stars)), extra)!, raw: { topProjects: repos.slice(0, 5) } },
    { key: "contribution_depth", value: aggregateItems(qualifying.map(depth), extra)!, raw: { largestChangeLines: Math.max(...qualifying.map((pr) => pr.additions + pr.deletions)) } },
    { key: "distinct_projects", value: 100 * Math.min(1, byRepo.size / DISTINCT_PROJECT_SATURATION), raw: { projects: byRepo.size } },
  ];
  const latest = qualifying.map((pr) => pr.mergedAt).filter((x): x is string => x !== null).sort().at(-1);
  if (latest) {
    const days = Math.max(0, (Date.parse(asOf) - Date.parse(latest)) / 86_400_000);
    measures.push({ key: "recency", value: 100 * Math.pow(0.5, days / n.ossRecencyHalfLifeDays!), raw: { lastMergedAt: latest, daysSince: Math.round(days) } });
  }
  return { measures: measures.map((m) => ({ ...m, value: Math.round(m.value * 100) / 100 })), qualifying, excluded };
}
