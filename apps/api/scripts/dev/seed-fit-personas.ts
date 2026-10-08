/**
 * Create (or refresh) the JD-fit personas as real email/password accounts in the configured dev
 * databases, with their candidate profile and source fragments. Dev only.
 *
 *   pnpm exec tsx --env-file=.env scripts/dev/seed-fit-personas.ts            # dry run
 *   pnpm exec tsx --env-file=.env scripts/dev/seed-fit-personas.ts --apply    # create / refresh
 *   pnpm exec tsx --env-file=.env scripts/dev/seed-fit-personas.ts --remove   # delete every persona account
 *
 * Fragments are written directly (no connection rows), so the weekly refresh jobs never try to
 * fetch these fabricated handles from GitHub or LeetCode.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Container } from "../../src/container.js";
import type { ProfileFragmentDoc } from "../../src/db/mongo/client.js";
import { canonicalize, sha256Hex } from "../../src/lib/canonicalJson.js";
import { hashPassword } from "../../src/lib/password.js";
import { seeded, withContainer } from "./bootstrap.js";
import { FIT_PERSONAS, PERSONA_PASSWORD, personaEmail, type FitPersona, type PersonaCodeforces, type PersonaGitHub, type PersonaLeetCode } from "./fitPersonas.js";

const NOW = new Date();
const ADVANCED_LEETCODE_TAGS = new Set(["Dynamic Programming", "Backtracking", "Trie", "Union Find", "Monotonic Stack", "Segment Tree", "Topological Sort", "Shortest Path"]);

/** The shape `toGitHubFragmentJson` stores. */
export function githubFragment(g: PersonaGitHub): Record<string, unknown> {
  const rand = seeded(g.login);
  const totalBytes = 420_000;
  const languages = g.languages.map(([name, pct]) => ({ name, pct, bytes: Math.round((totalBytes * pct) / 100) }));
  const perDay = g.activity === "high" ? 2.2 : g.activity === "medium" ? 0.9 : 0.25;
  const weeks = Array.from({ length: 52 }, () => Array.from({ length: 7 }, () => (rand() < 0.55 ? Math.round(rand() * perDay * 3) : 0)));
  const lastYear = weeks.flat().reduce((a, b) => a + b, 0);
  const topRepos = [...g.repos].sort((a, b) => b.stars - a.stars).map((r) => ({ name: r.name, stars: r.stars, primaryLang: r.primaryLang }));
  const readmes = g.repos.filter((r) => r.readme).map((r) => ({ repo: r.name, description: r.description.slice(0, 300), text: r.readme!.replace(/\s+/g, " ").trim().slice(0, 2000) }));
  const mergedPullRequests = (g.mergedPRs ?? []).map((pr) => ({ repo: pr.repo, stars: pr.stars < 100 ? pr.stars : Number(pr.stars.toPrecision(2)), additions: pr.additions, deletions: pr.deletions, changedFiles: pr.changedFiles, docsOnly: pr.docsOnly ?? false, mergedAt: pr.mergedAt, title: pr.title }))
    .sort((a, b) => b.mergedAt.localeCompare(a.mergedAt));
  return {
    login: g.login, name: g.login, avatarUrl: "", joinedYear: g.joinedYear, publicRepos: g.repos.length + Math.round(rand() * 6),
    contributions: { lastYear, weeks }, languages, topRepos, externalPRs: mergedPullRequests.length,
    ...(readmes.length ? { readmes } : {}), ...(mergedPullRequests.length ? { mergedPullRequests } : {}),
  };
}

/** The shape `toLeetCodeFragmentJson` stores. */
export function leetcodeFragment(l: PersonaLeetCode): Record<string, unknown> {
  const [easy, medium, hard] = l.solved;
  const byTopic = Object.entries(l.topics).map(([topic, count]) => ({ topic, count })).sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));
  const totalParticipants = 800_000;
  const contest = l.contest ? { attended: l.contest.attended, rating: l.contest.rating, globalRanking: Math.round((totalParticipants * l.contest.topPercent) / 100), totalParticipants, topPercent: l.contest.topPercent } : null;
  const activeWeeks = Math.min(52, Math.max(l.last30Days > 0 ? 4 : 0, Math.round((easy + medium + hard) / 12)));
  const advancedTopics = byTopic.filter((t) => ADVANCED_LEETCODE_TAGS.has(t.topic));
  return {
    username: l.username, country: "India", solved: { easy, medium, hard, total: easy + medium + hard }, byTopic, contest,
    recentActivity: { last30Days: l.last30Days, preferredLanguage: l.preferredLanguage }, calendar: { activeWeeks, windowWeeks: 52, last30Days: l.last30Days },
    streak: null, partial: false, ...(advancedTopics.length ? { advancedTopics } : {}),
  };
}

/** The shape the Codeforces collector stores. */
export function codeforcesFragment(cf: PersonaCodeforces): Record<string, unknown> {
  const rand = seeded(cf.handle);
  const [easy, medium, hard] = cf.solved;
  const history: { at: number; rating: number; rank: number }[] = [];
  let rating = 1200;
  const start = Math.floor(Date.UTC(2024, 0, 1) / 1000);
  for (let i = 0; i < cf.contests; i++) {
    const target = i === cf.contests - 1 ? cf.rating : Math.min(cf.maxRating, 1200 + ((cf.rating - 1200) * (i + 1)) / cf.contests + (rand() - 0.5) * 120);
    rating = Math.round(target);
    history.push({ at: start + i * 12 * 86_400, rating, rank: 500 + Math.round(rand() * 6000) });
  }
  return {
    platform: "codeforces", handle: cf.handle, info: { rating: cf.rating, maxRating: cf.maxRating }, ratingHistory: history,
    solved: { easy, medium, hard }, totalSolved: easy + medium + hard,
    byTopic: Object.entries(cf.topics).map(([topic, count]) => ({ topic, count })).sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic)),
    contestsAttended: cf.contests, consistency: { activeWeeks: Math.min(52, Math.round(cf.contests / 1.5)), windowWeeks: 52 }, recentActivity: { last30Days: cf.last30Days },
  };
}

export function personaFragments(p: FitPersona): Omit<ProfileFragmentDoc, "_id" | "userId">[] {
  const fragment = (source: ProfileFragmentDoc["source"], data: Record<string, unknown>): Omit<ProfileFragmentDoc, "_id" | "userId"> =>
    ({ source, data, contentHash: sha256Hex(canonicalize(data)), version: 1, fetchedAt: NOW });
  return [
    ...(p.github ? [fragment("GITHUB", githubFragment(p.github))] : []),
    ...(p.leetcode ? [fragment("LEETCODE", leetcodeFragment(p.leetcode))] : []),
    ...(p.codeforces ? [fragment("CODEFORCES", codeforcesFragment(p.codeforces))] : []),
  ];
}

async function seedPersona(c: Container, p: FitPersona, apply: boolean): Promise<string> {
  const email = personaEmail(p);
  const existing = await c.repos.users.findByEmailInsensitive(email);
  if (!apply) return `${existing ? "refresh" : "create"} ${email} (${p.level}, ${personaFragments(p).map((f) => f.source).join("+") || "resume only"})`;
  const passwordHash = await hashPassword(PERSONA_PASSWORD);
  const user = existing ?? await c.repos.users.insertWithPassword({ email, name: p.name, passwordHash, role: "USER" });
  await c.repos.users.setPasswordAndMarkVerified(user.id, passwordHash, NOW);
  await c.repos.users.markOnboardingComplete(user.id);
  await c.repos.candidateProfiles.save({
    userId: user.id, fullName: p.name, email, phone: null, location: p.location, headline: p.headline, portfolioWebsite: null,
    targetRole: null, targetJdId: null, level: p.level,
    education: p.education, experience: p.experience, projects: p.projects, skills: p.skills, achievements: p.achievements,
    detectedLinks: { github: p.github ? `https://github.com/${p.github.login}` : null, leetcode: p.leetcode ? `https://leetcode.com/u/${p.leetcode.username}/` : null, linkedin: null },
    resumeFilename: `${p.name.replace(/\s+/g, "_")}_Resume.pdf`, resumeParsedAt: NOW,
  });
  for (const source of ["GITHUB", "LEETCODE", "CODEFORCES", "TUF", "LINKEDIN"] as const) await c.repos.fragments.deleteByUserIdAndSource(user.id, source);
  for (const f of personaFragments(p)) await c.repos.fragments.insert({ userId: user.id, ...f });
  return `${existing ? "refreshed" : "created"} ${email} (${p.level})`;
}

async function removePersona(c: Container, p: FitPersona): Promise<string> {
  const email = personaEmail(p);
  const user = await c.repos.users.findByEmailInsensitive(email);
  if (!user) return `absent ${email}`;
  const removed = await c.accountDeletion.delete(user.id, { confirmEmail: email, password: PERSONA_PASSWORD });
  return `${removed ? "removed" : "not removed"} ${email}`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((a) => a !== "--apply" && a !== "--remove")) throw new Error("Usage: seed-fit-personas.ts [--apply | --remove]");
  const apply = args.includes("--apply"), remove = args.includes("--remove");
  await withContainer(async (c) => {
    for (const p of FIT_PERSONAS) console.log(remove ? await removePersona(c, p) : await seedPersona(c, p, apply));
  });
  console.log(remove ? `Removed ${FIT_PERSONAS.length} persona accounts.` : apply ? `Seeded ${FIT_PERSONAS.length} personas. Password for every account: ${PERSONA_PASSWORD}` : "Dry run; re-run with --apply to write.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
