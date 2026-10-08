/**
 * Generic composite scoring. A composite component is the weighted mean of its sub-features. Weights
 * are relative, configuration-driven and level-specific (`default` covers unlisted levels). Which
 * sub-features take part is the caller's choice: older policies pass only the available ones
 * (missing data renormalized away); the current policy fills the missing ones with 0 first
 * (`fillMissing`), so what a candidate lacks counts against the component.
 */
import type { EngineeringLevel, ScoringConfig } from "./types.js";

/** `missing` marks a sub-feature filled in as 0 because no source produced it. */
export interface SubFeatureValue { key: string; value: number; evidenceIds: string[]; missing?: true }
export interface CompositeResult { score: number; evidenceIds: string[]; used: { key: string; value: number; weight: number; missing?: true }[] }

const clamp = (value: number) => Math.max(0, Math.min(100, value));

export function levelWeights(config: ScoringConfig, component: string, level: EngineeringLevel): Record<string, number> | null {
  const entry = config.v5Policy?.subFeatures[component];
  return entry ? entry[level] ?? entry.default : null;
}

/** Weighted mean over available keys; when a key appears more than once the strongest value is used. */
export function composite(weights: Record<string, number>, values: SubFeatureValue[]): CompositeResult | null {
  const best = new Map<string, SubFeatureValue>();
  for (const value of values) {
    if (!Object.hasOwn(weights, value.key) || !(weights[value.key]! > 0) || !Number.isFinite(value.value)) continue;
    const prior = best.get(value.key);
    if (!prior || value.value > prior.value) best.set(value.key, value);
  }
  const rows = [...best.values()].sort((a, b) => a.key < b.key ? -1 : 1);
  const total = rows.reduce((sum, row) => sum + weights[row.key]!, 0);
  if (!total) return null;
  return {
    score: clamp(rows.reduce((sum, row) => sum + clamp(row.value) * weights[row.key]!, 0) / total),
    evidenceIds: [...new Set(rows.flatMap((row) => row.evidenceIds))].sort(),
    used: rows.map((row) => ({ key: row.key, value: row.value, weight: weights[row.key]!, ...(row.missing ? { missing: true as const } : {}) })),
  };
}

/**
 * Every weighted sub-feature takes part: one that no source produced is added as 0 and marked
 * missing. `alternatives` lists groups of sub-features that are the same signal from different
 * platforms (a LeetCode or a Codeforces contest record); any one of them present satisfies the
 * group, so using a different platform is never a penalty. Only when the whole group is absent do
 * its members count as 0. With no values at all nothing is filled: the component itself is missing.
 */
export function fillMissing(weights: Record<string, number>, values: SubFeatureValue[], alternatives: string[][] = []): SubFeatureValue[] {
  if (!values.length) return values;
  const present = new Set(values.map((value) => value.key));
  const satisfied = new Set(alternatives.filter((group) => group.some((key) => present.has(key))).flat());
  const filled = Object.keys(weights).filter((key) => weights[key]! > 0 && !present.has(key) && !satisfied.has(key))
    .map((key): SubFeatureValue => ({ key, value: 0, evidenceIds: [], missing: true }));
  return [...values, ...filled];
}

/**
 * Best item dominates; each further item adds a small, diminishing share of the remaining headroom.
 * Adding a weak item can never lower the score, and volume alone cannot reach 100.
 */
export function aggregateItems(scores: number[], additionalItemWeights: number[]): number | null {
  const sorted = scores.filter(Number.isFinite).map(clamp).sort((a, b) => b - a);
  if (!sorted.length) return null;
  let score = sorted[0]!;
  for (let i = 1; i < sorted.length && i - 1 < additionalItemWeights.length; i++) score += (100 - score) * additionalItemWeights[i - 1]! * sorted[i]! / 100;
  return clamp(score);
}
