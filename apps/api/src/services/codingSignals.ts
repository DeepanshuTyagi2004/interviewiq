import type { ProfileSource } from "../domain/enums.js";
import type { PlanCodingProfile } from "../integrations/aiService/types.js";
import { isObject } from "../lib/json.js";
import type { ProfileFragmentRepository } from "../repositories/mongo.js";

/**
 * Curates a user's GitHub + LeetCode fragments into the compact, stable coding signals the
 * interview-prep pipeline grounds coding rounds in. Keeps only low-churn sub-objects — the volatile
 * weekly contribution grid is dropped so it doesn't invalidate the plan's input-hash cache.
 * Null for any source the user hasn't connected.
 */
export class CodingSignalsProvider {
  constructor(private readonly fragments: ProfileFragmentRepository) {}

  async forUser(userId: string): Promise<PlanCodingProfile> {
    const [github, leetcode] = await Promise.all([this.read(userId, "GITHUB"), this.read(userId, "LEETCODE")]);
    return {
      github: github ? githubSummary(github) : null,
      leetcode: leetcode ? leetcodeSummary(leetcode) : null,
    };
  }

  private async read(userId: string, source: ProfileSource): Promise<Record<string, unknown> | null> {
    const f = await this.fragments.findByUserIdAndSource(userId, source);
    return f && isObject(f.data) ? f.data : null;
  }
}

function githubSummary(f: Record<string, unknown>): Record<string, unknown> {
  const s: Record<string, unknown> = {};
  copy(s, f, "languages");
  copy(s, f, "topRepos");
  copy(s, f, "externalPRs");
  const contributions = f.contributions;
  if (isObject(contributions) && "lastYear" in contributions) s.contributionsLastYear = contributions.lastYear;
  return s;
}

function leetcodeSummary(f: Record<string, unknown>): Record<string, unknown> {
  const s: Record<string, unknown> = {};
  copy(s, f, "solved");
  copy(s, f, "byTopic");
  copy(s, f, "contest");
  copy(s, f, "recentActivity");
  return s;
}

function copy(target: Record<string, unknown>, source: Record<string, unknown>, field: string): void {
  const v = source[field];
  if (v !== undefined && v !== null) target[field] = v;
}
