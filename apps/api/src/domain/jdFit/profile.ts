/**
 * Sources → one `FitProfile`, built once per request and scored against every JD. Items and skills
 * come from the resume and GitHub; DSA topic counts from LeetCode, Codeforces and TUF. LinkedIn is
 * deliberately not read (most users don't have it), nor AtCoder/CodeChef (no topic data).
 */
import type { CandidateProfileDoc, ProfileFragmentDoc } from "../../db/mongo/client.js";
import type { EngineeringLevel } from "../engineeringLevels.js";
import type { ProfileSource } from "../enums.js";
import { experienceMonths } from "../profileScoring/experience.js";
import { readmeTemplate } from "../profileScoring/readmeTemplates.js";
import { list, number, object } from "../profileScoring/sanitization.js";
import { INTERNSHIP_TITLE } from "../profileScoring/semantic.js";
import { JD_FIT_CONFIG, type JdFitConfig } from "./config.js";
import { catalogueEmployer, jdDomain, platformTopicTags, tagItem, type CatalogueCompany } from "./tagger.js";
import type { FitItem, FitItemKind, FitProfile, TopicCount } from "./types.js";

export interface FitProfileInput {
  profile: CandidateProfileDoc | null;
  fragments: ProfileFragmentDoc[];
  /** The user's persisted current level. */
  level: EngineeringLevel | null;
  asOf: string;
  /** Student-visible catalogue companies: a job or internship at one counts toward its sector's domain. */
  catalogue?: readonly CatalogueCompany[];
}

const TOPIC_SOURCES: [ProfileSource, TopicCount["source"]][] = [["LEETCODE", "leetcode"], ["CODEFORCES", "codeforces"], ["TUF", "tuf"]];
/** Jobs first, so the strongest evidence is cited first. */
const KIND_ORDER: Record<FitItemKind, number> = { experience: 0, internship: 1, project: 2, repo: 3 };

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
/** " | " keeps a keyword phrase from spanning two separate entries. */
const join = (parts: unknown[]): string => parts.map(text).filter((p): p is string => p !== null).join(" | ").toLowerCase();

export function buildFitProfile(input: FitProfileInput, config: JdFitConfig = JD_FIT_CONFIG): FitProfile {
  const latest = latestBySource(input.fragments);
  const github = object(latest.get("GITHUB")?.data);
  const leetcode = object(latest.get("LEETCODE")?.data);
  const items = [...resumeItems(input.profile, input.catalogue ?? []), ...githubItems(github)].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);

  const topics: Record<string, TopicCount> = {};
  let totalSolved: TopicCount | null = null;
  for (const [source, name] of TOPIC_SOURCES) {
    const data = object(latest.get(source)?.data);
    // Broad DSA asks read the best single platform's total, never a sum (TUF syncs the others).
    const total = solvedTotal(data);
    if (total !== null && total > (totalSolved?.count ?? 0)) totalSolved = { count: total, source: name, name: "Problems solved" };
    for (const raw of list(data.byTopic)) {
      const row = object(raw), topic = text(row.topic), count = number(row.count);
      if (topic === null || count === null || count <= 0) continue;
      // Best single platform per topic, never a sum: TUF already syncs LeetCode/Codeforces solves,
      // and one problem carries several tags on the same platform.
      for (const tag of platformTopicTags(topic)) if (count > (topics[tag]?.count ?? 0)) topics[tag] = { count, source: name, name: topic };
    }
  }

  const fullTime = (input.profile?.experience ?? []).filter((e) => !INTERNSHIP_TITLE.test(e.title ?? ""));
  const months = experienceMonths({
    headline: null, education: [], projects: [], skills: [], achievements: [],
    experience: fullTime.map((e) => ({ title: e.title, startDate: e.startDate, endDate: e.endDate, bullets: e.bullets })),
  }, input.asOf).months;

  return {
    level: input.level,
    items,
    listedSkills: (input.profile?.skills ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean),
    githubLanguages: githubLanguages(github, config.githubLanguageMinPct),
    preferredLanguage: text(object(leetcode.recentActivity).preferredLanguage)?.toLowerCase() ?? null,
    topics,
    hasTopicSource: TOPIC_SOURCES.some(([source]) => latest.has(source)),
    totalSolved,
    fullTimeMonths: months,
  };
}

/** `totalSolved` (Codeforces, TUF), else LeetCode's `solved.total`, else its easy + medium + hard. */
function solvedTotal(data: Record<string, unknown>): number | null {
  const direct = number(data.totalSolved);
  if (direct !== null) return direct;
  const solved = object(data.solved), total = number(solved.total);
  if (total !== null && total > 0) return total;
  const parts = ["easy", "medium", "hard"].map((k) => number(solved[k]));
  return parts.some((v) => v !== null) ? parts.reduce<number>((sum, v) => sum + (v ?? 0), 0) : null;
}

function latestBySource(fragments: ProfileFragmentDoc[]): Map<ProfileSource, ProfileFragmentDoc> {
  const out = new Map<ProfileSource, ProfileFragmentDoc>();
  for (const f of fragments) {
    const prior = out.get(f.source);
    if (!prior || new Date(f.fetchedAt).getTime() > new Date(prior.fetchedAt).getTime()) out.set(f.source, f);
  }
  return out;
}

function item(source: FitItem["source"], kind: FitItemKind, title: string, body: string, tech: string[]): FitItem {
  return { source, kind, title, text: body, tech, ...tagItem(body, tech) };
}

function resumeItems(profile: CandidateProfileDoc | null, catalogue: readonly CatalogueCompany[]): FitItem[] {
  if (!profile) return [];
  const out: FitItem[] = [];
  for (const p of profile.projects ?? []) {
    const body = join([p.name, p.description, ...(p.bullets ?? []), ...(p.tech ?? [])]);
    if (body) out.push(item("resume", "project", text(p.name) ?? "Untitled project", body, (p.tech ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean)));
  }
  for (const e of profile.experience ?? []) {
    const kind: FitItemKind = INTERNSHIP_TITLE.test(e.title ?? "") ? "internship" : "experience";
    // The employer name counts: an internship at a payments company is fintech evidence.
    const body = join([e.title, e.company, ...(e.bullets ?? [])]);
    const title = [text(e.title), text(e.company)].filter(Boolean).join(" · ") || (kind === "internship" ? "Internship" : "Role");
    if (!body) continue;
    const tagged = item("resume", kind, title, body, []);
    // Working at a catalogue company is work in its domain (a generic sector such as IT services adds nothing).
    const employer = catalogueEmployer(e.company, catalogue);
    const domain = employer ? jdDomain(employer.sector) : null;
    if (employer && domain && !tagged.domains.some((d) => d.tag === domain)) tagged.domains.push({ tag: domain, matched: `${employer.name} (catalogue: ${domain})` });
    out.push(tagged);
  }
  return out;
}

/** Each fetched repo README (top public non-fork repos). A scaffold README is ignored; the description still counts. */
function githubItems(github: Record<string, unknown>): FitItem[] {
  const primary = new Map(list(github.topRepos).map((raw) => [text(object(raw).name)?.toLowerCase() ?? "", text(object(raw).primaryLang)]));
  return list(github.readmes).flatMap((raw) => {
    const r = object(raw), name = text(r.repo);
    if (!name) return [];
    const readme = text(r.text);
    const usable = readme !== null && readmeTemplate(readme) === null ? readme : null;
    const description = text(r.description);
    if (!usable && !description) return [];
    const lang = primary.get(name.toLowerCase()) ?? null;
    return [item("github", "repo", name, join([name, description, usable, lang]), lang ? [lang.toLowerCase()] : [])];
  });
}

/** Languages at or above `minPct` of the user's code bytes (stray Shell/Dockerfile bytes don't count). */
function githubLanguages(github: Record<string, unknown>, minPct: number): string[] {
  const rows = list(github.languages).map((raw) => { const x = object(raw); return { name: text(x.name), pct: number(x.pct), bytes: number(x.bytes) }; });
  const total = rows.reduce((sum, r) => sum + (r.bytes ?? 0), 0);
  return rows.filter((r) => r.name !== null && (r.pct ?? (total > 0 ? ((r.bytes ?? 0) * 100) / total : 0)) >= minPct).map((r) => r.name!.toLowerCase());
}
