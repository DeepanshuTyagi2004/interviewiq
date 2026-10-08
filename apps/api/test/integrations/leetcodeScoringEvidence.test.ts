import { describe, expect, it } from "vitest";
import { normalizeScoringInput } from "../../src/domain/profileScoring/adapters.js";
import { evaluateProfile } from "../../src/domain/profileScoring/engine.js";
import type { ScoringInput } from "../../src/domain/profileScoring/types.js";
import { toLeetCodeFragmentJson } from "../../src/integrations/leetcode/collector.js";

const asOf = "2026-10-04T00:00:00.000Z";
function input(rows: unknown[], recent: unknown = { recentAcSubmissionList: [] }): ScoringInput {
  const data = JSON.parse(toLeetCodeFragmentJson({ matchedUser: { submitStatsGlobal: { acSubmissionNum: rows } } }, null, recent, new Date(asOf), false));
  return { asOf, declaredLevel: null, profile: null, fragments: [{ source: "leetcode", data, contentHash: "", fetchedAt: asOf }] };
}

describe("LeetCode collection to profile scoring unknown boundaries", () => {
  it("keeps legacy descriptive zeros but never scores missing or malformed solve rows as zero", () => {
    const raw = input([{ difficulty: "Easy", count: "bad" }, { difficulty: "Medium", count: -1 }], null);
    expect(raw.fragments[0]!.data.solved).toMatchObject({ easy: 0, hard: 0 });
    const normalized = normalizeScoringInput(raw);
    expect(normalized.fragments[0]!.data.solved).toEqual({ easy: null, medium: null, hard: null });
    expect(normalized.fragments[0]!.data.recentActivity).toBeNull();
    expect(normalizeScoringInput(normalized)).toEqual(normalized);
    expect(evaluateProfile(raw)).toMatchObject({ score: null, confidence: 0, status: "insufficient_evidence" });
  });

  it("preserves evidenced zero as genuine attainment, rather than treating it as missing", () => {
    const result = evaluateProfile(input(["Easy", "Medium", "Hard"].map((difficulty) => ({ difficulty, count: 0 }))));
    expect(result.score).toBe(0);
    expect(result.components.find((c) => c.id === "coding")).toMatchObject({ score: 0, status: "available" });
    expect(result.evidence.filter((e) => e.path.includes("solved."))).toHaveLength(3);
    expect(result.confidence).toBe(90);
  });

  it("lowers confidence when only the easy bucket is observed and preserves its actual score", () => {
    const result = evaluateProfile(input([{ difficulty: "Easy", count: 100 }]));
    expect(result.components.find((c) => c.id === "coding")?.score).toBe(100);
    expect(result.confidence).toBe(13.5); // 90 baseline × 15% observed difficulty weight
    expect(result.eligibility.eligible).toBe(false);
    expect(result.warnings).toContain("leetcode: incomplete difficulty distribution; coding confidence is scaled by observed difficulty weight, missing buckets remain unknown");
  });
});
