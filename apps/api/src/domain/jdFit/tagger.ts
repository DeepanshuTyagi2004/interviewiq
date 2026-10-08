/**
 * Keyword tagging for JD fit. Pure: dictionary in, tags with evidence out. Profile items and JD fields
 * go through the same vocabulary, so a match is plain set overlap.
 */
import type { TagHit } from "./types.js";
import { DOMAINS, DSA_TOPICS, GENERAL_DSA_TOPICS, NON_SKILL_STACK_TERMS, ROLES, SKILLS, SPECIALIZATION_ROLES, type SkillEntry, type VocabEntry } from "./vocabulary.js";

const patterns = new Map<string, RegExp>();

export const normalizeTerm = (term: string): string => term.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Whole word, case-insensitive. No letter, digit or code punctuation (`_ + # . -`) may sit directly
 * before the keyword, nor a letter, digit or `_ + #` directly after: `java` never matches
 * `javascript`, `c` never matches `c++`, `.net` never matches inside `asp.net`.
 */
function pattern(keyword: string): RegExp {
  const key = normalizeTerm(keyword);
  let re = patterns.get(key);
  if (!re) {
    const body = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
    re = new RegExp(`(?<![a-z0-9_+#.-])${body}(?![a-z0-9_+#])`, "gi");
    patterns.set(key, re);
  }
  return re;
}

function spans(text: string, keyword: string): { start: number; end: number }[] {
  const re = pattern(keyword);
  re.lastIndex = 0;
  const out: { start: number; end: number }[] = [];
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    out.push({ start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

const byLength = (keywords: readonly string[]) => [...keywords].sort((a, b) => b.length - a.length);

/** The longest of `keywords` found in `text` as a whole word, or null. */
export function findKeyword(text: string, keywords: readonly string[]): string | null {
  for (const keyword of byLength(keywords)) if (spans(text, keyword).length > 0) return keyword;
  return null;
}

/**
 * Every tag of `table` whose keyword appears in `text`. Longer keywords claim their span first, so
 * "react native" tags android/ios without also reading as "react", and "binary search trees" is a
 * tree topic, not binary search.
 */
export function tagText(text: string, table: readonly VocabEntry[]): TagHit[] {
  const found: { tag: string; keyword: string; start: number; end: number }[] = [];
  for (const entry of table) {
    for (const keyword of entry.keywords) for (const s of spans(text, keyword)) found.push({ tag: entry.tag, keyword, ...s });
  }
  found.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const claimed: { start: number; end: number }[] = [];
  const hits = new Map<string, TagHit>();
  for (const f of found) {
    const free = claimed.every((c) => (c.start === f.start && c.end === f.end) || f.end <= c.start || f.start >= c.end);
    if (!free) continue;
    claimed.push(f);
    if (!hits.has(f.tag)) hits.set(f.tag, { tag: f.tag, matched: f.keyword });
  }
  return [...hits.values()];
}

/** Domain and role tags for one item. Backend + frontend in one item also makes it full-stack. */
export function tagItem(text: string, tech: string[]): { domains: TagHit[]; roles: TagHit[] } {
  const all = [text, ...tech].join(" | ");
  const domains = tagText(all, DOMAINS);
  const roles = tagText(all, ROLES);
  const backend = roles.find((r) => r.tag === "backend");
  const frontend = roles.find((r) => r.tag === "frontend");
  if (backend && frontend && !roles.some((r) => r.tag === "fullstack")) roles.push({ tag: "fullstack", matched: `${backend.matched} + ${frontend.matched}` });
  return { domains, roles };
}

// --- Employers ------------------------------------------------------------------------------------

/** A catalogue company, as employer matching needs it. */
export interface CatalogueCompany {
  name: string;
  slug: string;
  aliases: readonly string[];
  sector: string | null;
}

const LEGAL_WORDS = /\b(?:private|pvt|limited|ltd|inc|incorporated|llc|llp|plc|corp|corporation|gmbh)\b\.?/g;

/** "Salescode.ai" / "Razorpay Software Pvt. Ltd." → "salescode" / "razorpaysoftware": web suffix and legal words off, letters and digits only. */
export function companyKey(name: string): string {
  const base = name.toLowerCase().trim().replace(/\.(?:ai|io|com|in|co|app|club|tech)\b/g, " ");
  const key = base.replace(LEGAL_WORDS, " ").replace(/[^a-z0-9]+/g, "");
  return key || base.replace(/[^a-z0-9]+/g, "");
}

/** The catalogue company an employer name is, by exact key on its name, slug or an alias (never a partial match). */
export function catalogueEmployer(employer: string | null | undefined, catalogue: readonly CatalogueCompany[]): CatalogueCompany | null {
  const key = employer ? companyKey(employer) : "";
  if (!key) return null;
  return catalogue.find((co) => [co.name, co.slug, ...co.aliases].some((name) => companyKey(name) === key)) ?? null;
}

// --- JD side ---------------------------------------------------------------------------------------

const DOMAIN_TAGS = new Set(DOMAINS.map((d) => d.tag));

/** The company's domain tag, or null for a missing or generic sector. */
export function jdDomain(sector: string | null): string | null {
  const s = sector ? normalizeTerm(sector) : "";
  return DOMAIN_TAGS.has(s) ? s : null;
}

/**
 * Domains the JD asks for: the company's sector when it is specific; otherwise whatever domains the
 * JD's own title and description name (a delivery platform's JD at a "consumer internet" company).
 */
export function jdDomains(sector: string | null, text: string): { tags: TagHit[]; fromText: boolean } {
  const domain = jdDomain(sector);
  if (domain !== null) return { tags: [{ tag: domain, matched: domain }], fromText: false };
  return { tags: tagText(text, DOMAINS), fromText: true };
}

export const ALL_ROLE_TAGS: readonly string[] = ROLES.map((r) => r.tag);

/**
 * Role tags that satisfy the JD's specialization. A missing specialization, or one that is a hiring
 * track rather than a role family (TCS Ninja, Accenture ASE, Infosys SP), is a generalist SDE role:
 * any software role counts.
 */
export function jdRoles(specialization: string | null): { tags: readonly string[]; generalist: boolean } {
  const s = specialization ? normalizeTerm(specialization).replace(/_/g, "-") : "";
  return s && Object.hasOwn(SPECIALIZATION_ROLES, s) ? { tags: SPECIALIZATION_ROLES[s]!, generalist: false } : { tags: ALL_ROLE_TAGS, generalist: true };
}

export interface CanonicalSkill {
  id: string;
  label: string;
  aliases: string[];
  strict: string[];
  /** Skills whose use shows this one too (one level deep). */
  impliedBy: string[];
  /** Role tags whose work shows this skill. */
  impliedByRoles: string[];
}

const SKILL_BY_ALIAS = new Map<string, SkillEntry>();
const SKILL_BY_ID = new Map<string, SkillEntry>();
for (const s of SKILLS) {
  SKILL_BY_ID.set(s.id, s);
  for (const alias of [s.id, s.label, ...s.aliases, ...(s.strict ?? [])].map(normalizeTerm)) if (!SKILL_BY_ALIAS.has(alias)) SKILL_BY_ALIAS.set(alias, s);
}

const toCanonical = (s: SkillEntry): CanonicalSkill => ({ id: s.id, label: s.label, aliases: s.aliases.map(normalizeTerm), strict: (s.strict ?? []).map(normalizeTerm), impliedBy: s.impliedBy ?? [], impliedByRoles: s.impliedByRoles ?? [] });

/** A JD stack term as a canonical skill; unknown terms match themselves (strictly when 1–2 characters). */
export function canonicalSkill(term: string): CanonicalSkill {
  const key = normalizeTerm(term);
  const known = SKILL_BY_ALIAS.get(key);
  if (known) return toCanonical(known);
  return key.length <= 2 ? { id: key, label: term.trim(), aliases: [], strict: [key], impliedBy: [], impliedByRoles: [] } : { id: key, label: term.trim(), aliases: [key], strict: [], impliedBy: [], impliedByRoles: [] };
}

/**
 * A JD stack term as the skills that satisfy it. "JavaScript / TypeScript" is either one; "CI / CD"
 * is the one skill spelled with spaces. Any alternative covers the term.
 */
export function canonicalSkills(term: string): CanonicalSkill[] {
  const key = normalizeTerm(term);
  const joined = key.replace(/\s*\/\s*/g, "/");
  if (SKILL_BY_ALIAS.has(joined)) return [canonicalSkill(joined)];
  if (key.includes("/")) return key.split("/").map((part) => part.trim()).filter(Boolean).map(canonicalSkill);
  return [canonicalSkill(term)];
}

export function skillById(id: string): CanonicalSkill | null {
  const entry = SKILL_BY_ID.get(id);
  return entry ? toCanonical(entry) : null;
}

const NON_SKILL = new Set(NON_SKILL_STACK_TERMS.map(normalizeTerm));

/** A stack entry that is an assessment or a trait ("Aptitude"), not a skill anyone can show. */
export function isNonSkillTerm(term: string): boolean {
  return NON_SKILL.has(normalizeTerm(term));
}

const listParts = (entry: string) => entry.split(/[,;/|()]+/).map((p) => p.trim()).filter(Boolean);

/**
 * A structured entry (tech list, skills list, language) that shows `skill`, or null. Strict aliases
 * must be a whole entry or comma part ("Go", "Go, Rust"), never a word inside a phrase.
 */
export function matchInList(entries: readonly string[], skill: CanonicalSkill): string | null {
  for (const entry of entries) {
    if (skill.strict.some((alias) => listParts(entry).includes(alias))) return entry;
    if (findKeyword(entry, skill.aliases)) return entry;
  }
  return null;
}

/** Prose that mentions `skill` (non-strict aliases only), as the alias found. */
export function matchInText(text: string, skill: CanonicalSkill): string | null {
  return skill.aliases.length ? findKeyword(text, skill.aliases) : null;
}

// --- DSA topics ------------------------------------------------------------------------------------

const TOPIC_BY_NAME = new Map<string, string>();
for (const t of DSA_TOPICS) for (const k of t.keywords.map(normalizeTerm)) if (!TOPIC_BY_NAME.has(k)) TOPIC_BY_NAME.set(k, t.tag);

const GENERAL_DSA = new Set(GENERAL_DSA_TOPICS.map(normalizeTerm));

/** A broad DSA ask ("Data structures", "Coding problems") rather than a specific topic. */
export function isGeneralDsaTopic(topic: string): boolean {
  return GENERAL_DSA.has(normalizeTerm(topic).replace(/[.:]+$/, ""));
}

/** Rounds whose topics can be DSA asks: coding rounds and online tests. System design, behavioural and hiring-manager rounds never are. */
export function isCodingRound(type: string | null): boolean {
  const t = type?.trim().toLowerCase() ?? "";
  return t === "" || t === "dsa" || t === "lld" || t === "coding" || t === "online-test" || t === "take-home";
}

/** Canonical topics a round's free-text topic covers ("Graphs (BFS/DFS)" → graphs). Non-DSA topics → []. */
export function roundTopicTags(topic: string): string[] {
  return tagText(normalizeTerm(topic), DSA_TOPICS).map((h) => h.tag);
}

/** Canonical topics of a platform's own topic name: exact name first, else scanned. */
export function platformTopicTags(name: string): string[] {
  const exact = TOPIC_BY_NAME.get(normalizeTerm(name));
  return exact ? [exact] : roundTopicTags(name);
}

export function topicLabel(tag: string): string {
  return DSA_TOPICS.find((t) => t.tag === tag)?.label ?? tag;
}
