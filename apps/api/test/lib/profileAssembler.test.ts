import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ProfileFragmentDoc } from "../../src/db/mongo/client.js";
import type { ProfileSource } from "../../src/domain/enums.js";
import { assembleProfileBands } from "../../src/services/profileAssembler.js";

/** Ported from synthesis/RuleBasedProfileAssemblerTest.java. */

function frag(source: ProfileSource, data: Record<string, unknown>, contentHash = "hash"): ProfileFragmentDoc {
  return { _id: randomUUID(), userId: randomUUID(), source, data, contentHash, version: 1, fetchedAt: new Date() };
}

function githubFragment(): ProfileFragmentDoc {
  return frag("GITHUB", {
    login: "aishav",
    name: "Aisha Verma",
    avatarUrl: "x",
    joinedYear: 2021,
    publicRepos: 38,
    contributions: { lastYear: 1204, weeks: [] },
    languages: [
      { name: "TypeScript", pct: 48, bytes: 1234567 },
      { name: "Python", pct: 30, bytes: 700000 },
    ],
    externalPRs: 17,
    topRepos: [{ name: "campus-placement-bot", stars: 42, primaryLang: "TypeScript" }],
  });
}

function leetcodeFragment(): ProfileFragmentDoc {
  return frag(
    "LEETCODE",
    {
      username: "aakash_42",
      country: "India",
      solved: { easy: 78, medium: 268, hard: 66, total: 412 },
      byTopic: [
        { topic: "Array", count: 90 },
        { topic: "String", count: 60 },
        { topic: "Hash Table", count: 55 },
      ],
      contest: { attended: 12, rating: 1751, globalRanking: 50000, totalParticipants: 800000, topPercent: 6.25 },
      recentActivity: { last30Days: 3, preferredLanguage: "python3" },
      streak: null,
      partial: false,
    },
    "hash-lc",
  );
}

describe("assembleProfileBands (ported from RuleBasedProfileAssemblerTest)", () => {
  it("assemble_buildsNotableFromContributionsAndPRs", () => {
    const bands = assembleProfileBands([githubFragment()]);

    expect(bands.notable.some((n) => n.text.includes("1,204") && n.text.includes("contributions") && n.source === "GITHUB")).toBe(true);
    expect(bands.notable.some((n) => n.text.includes("17") && n.text.includes("pull request"))).toBe(true);
  });

  it("assemble_skillsCarryEvidenceNamingTheSource", () => {
    const bands = assembleProfileBands([githubFragment()]);

    expect(bands.mostUsedSkills.length).toBeGreaterThan(0);
    expect(bands.mostUsedSkills[0]!.skill).toBe("TypeScript");
    expect(bands.mostUsedSkills[0]!.evidence).toBe("GitHub 48%");
    // every skill must carry evidence (CLAUDE.md hard rule)
    for (const s of bands.mostUsedSkills) expect(s.evidence.trim()).not.toBe("");
  });

  it("assemble_atAGlanceDescribesActivity", () => {
    const bands = assembleProfileBands([githubFragment()]);
    expect(bands.atAGlance.length).toBeGreaterThan(0);
    expect(bands.atAGlance.join(" ")).toContain("38 repos");
  });

  it("assemble_outputContainsNoScoringOrRankingFields", () => {
    for (const fragments of [[githubFragment()], [githubFragment(), leetcodeFragment()]]) {
      const json = JSON.stringify(assembleProfileBands(fragments)).toLowerCase();
      // Key-name guards: score/rating/rank/grade must never appear as JSON field names.
      expect(json).not.toContain('"score"');
      expect(json).not.toContain('"rating"');
      expect(json).not.toContain('"rank"');
      expect(json).not.toContain('"grade"');
      // Value-text guards for phrases that are never part of descriptive language.
      expect(json).not.toContain("percentile");
      expect(json).not.toContain("above average");
      expect(json).not.toContain("better than");
    }
  });

  it("assemble_withNoFragments_returnsEmptyBands", () => {
    const bands = assembleProfileBands([]);
    expect(bands.notable).toEqual([]);
    expect(bands.mostUsedSkills).toEqual([]);
    expect(bands.atAGlance).toEqual([]);
  });

  /** Non-GITHUB fragments alongside a GITHUB one are safely ignored ("sources are additive, never required"). */
  it("assemble_ignoresNonGithubFragmentsSafely", () => {
    const resumeFrag = frag("RESUME", { education: "B.Tech CSE", skills: ["Java", "SQL"] }, "hash-r");
    // A LEETCODE fragment in a legacy/foreign shape (no `solved` / `byTopic` / `contest` keys).
    const leetcodeFrag = frag("LEETCODE", { totalSolved: 412, easy: 78, medium: 268, hard: 66 }, "hash-l");

    const bands = assembleProfileBands([githubFragment(), resumeFrag, leetcodeFrag]);

    // GITHUB data is still extracted correctly
    expect(bands.notable.some((n) => n.text.includes("1,204") && n.text.includes("contributions"))).toBe(true);
    expect(bands.mostUsedSkills.length).toBeGreaterThan(0);
    expect(bands.atAGlance.length).toBeGreaterThan(0);

    // No data from the non-GITHUB fragments leaked into the output
    const allText =
      bands.notable.map((n) => n.text + n.source).join("") +
      bands.mostUsedSkills.map((s) => s.skill + s.evidence).join("") +
      bands.atAGlance.join(" ");
    expect(allText).not.toContain("B.Tech");
    expect(allText).not.toContain("totalSolved");
    expect(allText).not.toContain("412");
  });

  it("assemble_buildsDescriptiveLeetCodeBands", () => {
    const bands = assembleProfileBands([leetcodeFragment()]);

    // solved split described against the source, never graded
    expect(
      bands.notable.some(
        (n) =>
          n.text.includes("412") &&
          n.text.includes("78 Easy") &&
          n.text.includes("268 Medium") &&
          n.text.includes("66 Hard") &&
          n.source === "LEETCODE",
      ),
    ).toBe(true);
    // contest activity described
    expect(bands.notable.some((n) => n.text.includes("12 LeetCode contests"))).toBe(true);
    // preferred language + top topics surface as evidence-bearing skills (CLAUDE.md hard rule)
    expect(bands.mostUsedSkills.some((s) => s.skill === "python3" && s.evidence.includes("LeetCode"))).toBe(true);
    expect(bands.mostUsedSkills.some((s) => s.skill === "Array")).toBe(true);
    for (const s of bands.mostUsedSkills) expect(s.evidence.trim()).not.toBe("");
    expect(bands.atAGlance.join(" ")).toContain("412 LeetCode problems");
  });
});

describe("assembleProfileBands — exact Java output", () => {
  it("GitHub + LeetCode bands match the Java RuleBasedProfileAssembler strings exactly", () => {
    const bands = assembleProfileBands([githubFragment(), leetcodeFragment()]);
    expect(bands).toEqual({
      notable: [
        { text: "1,204 GitHub contributions in the last year", source: "GITHUB" },
        { text: "17 external pull request contributions to other projects", source: "GITHUB" },
        { text: "412 LeetCode problems solved (78 Easy, 268 Medium, 66 Hard)", source: "LEETCODE" },
        { text: "Competed in 12 LeetCode contests (rating 1751)", source: "LEETCODE" },
      ],
      mostUsedSkills: [
        { skill: "TypeScript", evidence: "GitHub 48%", source: "GITHUB" },
        { skill: "Python", evidence: "GitHub 30%", source: "GITHUB" },
        { skill: "python3", evidence: "LeetCode preferred (recent submissions)", source: "LEETCODE" },
        { skill: "Array", evidence: "LeetCode: 90 solved", source: "LEETCODE" },
        { skill: "String", evidence: "LeetCode: 60 solved", source: "LEETCODE" },
        { skill: "Hash Table", evidence: "LeetCode: 55 solved", source: "LEETCODE" },
      ],
      atAGlance: ["Most active in TypeScript and Python across 38 repos", "Solved 412 LeetCode problems; most-solved topics: Array, String"],
    });
  });

  it("trace languages (< 5%) and low-count topics (< 5 solves) are not skills; singular contest wording", () => {
    const g = frag("GITHUB", {
      publicRepos: 3,
      languages: [
        { name: "Go", pct: 95 },
        { name: "Shell", pct: 4 },
      ],
    });
    const lc = frag("LEETCODE", {
      solved: { easy: 1, medium: 0, hard: 0, total: 1234 },
      byTopic: [
        { topic: "Math", count: 5 },
        { topic: "Graph", count: 4 },
        { topic: "Tree", count: 0 },
      ],
      contest: { attended: 1, rating: 0 },
      recentActivity: { preferredLanguage: null },
    });
    const bands = assembleProfileBands([g, lc]);
    expect(bands.mostUsedSkills.map((s) => s.skill)).toEqual(["Go", "Math"]);
    // Shell is still named in the at-a-glance line (top two languages regardless of share)
    expect(bands.atAGlance).toEqual(["Most active in Go and Shell across 3 repos", "Solved 1,234 LeetCode problems; most-solved topics: Math, Graph"]);
    expect(bands.notable).toContainEqual({ text: "Competed in 1 LeetCode contest", source: "LEETCODE" });
    expect(bands.notable).toContainEqual({ text: "1,234 LeetCode problems solved (1 Easy, 0 Medium, 0 Hard)", source: "LEETCODE" });
  });

  it("zero-valued GitHub counts produce no notable items; the first fragment per source wins", () => {
    const quiet = frag("GITHUB", { publicRepos: 0, contributions: { lastYear: 0 }, externalPRs: 0, languages: [] });
    const other = frag("GITHUB", { contributions: { lastYear: 999 }, externalPRs: 5, languages: [{ name: "Rust", pct: 100 }] });
    expect(assembleProfileBands([quiet, other])).toEqual({ notable: [], mostUsedSkills: [], atAGlance: [] });
  });
});
