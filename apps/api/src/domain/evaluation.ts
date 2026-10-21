import { normalizeLegacyLevel, type EngineeringLevel } from "./engineeringLevels.js";

/** Pass mark, code standard, retake cooldown and readiness for a graded mock round (spec §7.5, §8.5, §10). */

export const PASS_BASE: Record<EngineeringLevel, number> = {
  intern: 6.0, fresher: 6.0, sde1: 6.5, sde2: 7.0, sde3: 7.5, staff: 7.5, principal: 7.5, distinguished: 7.5,
};

export type Difficulty = "easy" | "medium" | "hard";

/** base by level + company tier (1: +0.5, 2: +0.25) + hard round (+0.25), clamped 5.5-8.5, one decimal (half up). */
export function passMark(input: { level: string | null; tier: number | null; difficulty: Difficulty | null }): number {
  const base = PASS_BASE[normalizeLegacyLevel(input.level) ?? "sde1"];
  const tier = input.tier === 1 ? 0.5 : input.tier === 2 ? 0.25 : 0;
  const hard = input.difficulty === "hard" ? 0.25 : 0;
  const clamped = Math.min(8.5, Math.max(5.5, base + tier + hard));
  return Math.floor(clamped * 10 + 0.5 + 1e-9) / 10;
}

export type CodeStandard = "runnable" | "near_runnable" | "pseudo_ok";

/** An admin override wins; otherwise derived from company tier and business model. */
export function codeStandardFor(tier: number | null, businessModel: string | null, override: CodeStandard | null): CodeStandard {
  if (override) return override;
  const model = businessModel?.trim().toLowerCase() ?? null;
  if ((tier === 1 || tier === 2) && (model === "product" || model === "hybrid")) return "runnable";
  if (tier === 4 || model === "service") return "pseudo_ok";
  return "near_runnable";
}

export type EvalOutcome = "passed" | "below_pass" | "auto_fail" | "unscorable";

const DAY_MS = 24 * 60 * 60 * 1000;

/** below pass by < 1.0 -> 7 days; by >= 1.0 or auto_fail -> 14 days; passed/unscorable -> no cooldown. */
export function retakeAfter(outcome: EvalOutcome, score: number | null, passMarkValue: number, evaluatedAt: Date): Date | null {
  if (outcome === "auto_fail") return new Date(evaluatedAt.getTime() + 14 * DAY_MS);
  if (outcome !== "below_pass") return null;
  const gap = score === null ? Infinity : passMarkValue - score;
  return new Date(evaluatedAt.getTime() + (gap < 1.0 - 1e-9 ? 7 : 14) * DAY_MS);
}

export type ReadinessLevel = "getting_started" | "progressing" | "nearly_ready" | "interview_ready";

/** Rounds passed only, not score height. */
export function readinessLevel(passed: number, total: number): ReadinessLevel {
  if (total > 0 && passed >= total) return "interview_ready";
  if (passed <= 0) return "getting_started";
  if (passed === total - 1) return "nearly_ready";
  return "progressing";
}
