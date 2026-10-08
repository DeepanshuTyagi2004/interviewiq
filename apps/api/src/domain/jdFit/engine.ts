/**
 * JD fit: how closely one user's profile matches one JD (`docs/jd-fit.md`). Pure and deterministic:
 * no I/O, no LLM. Fit only, never strength: the profile score is not blended in, and nothing here
 * feeds interview results, gating, readiness or leaderboards.
 */
import { ENGINEERING_LEVELS, type EngineeringLevel } from "../engineeringLevels.js";
import { JD_FIT_CONFIG, type FitPartKey, type JdFitConfig } from "./config.js";
import { canonicalSkills, isCodingRound, isGeneralDsaTopic, isNonSkillTerm, jdDomains, jdRoles, matchInList, matchInText, roundTopicTags, skillById, topicLabel, type CanonicalSkill } from "./tagger.js";
import type { FitEvidence, FitJd, FitPart, FitProfile, FitResult, LevelGap, TagHit } from "./types.js";
import { GENERIC_SECTORS } from "./vocabulary.js";

type Draft = Omit<FitPart, "weight">;

const round3 = (v: number) => Math.round(v * 1000) / 1000;
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

const scored = (key: FitPartKey, value: number, evidence: FitEvidence[], uncovered: string[] = []): Draft =>
  ({ key, value: round3(Math.min(1, Math.max(0, value))), status: "scored", evidence, uncovered, hint: null, reason: null });
/** The JD asks for it and the user has no source for it: counts 0. */
const missing = (key: FitPartKey, hint: string, uncovered: string[] = []): Draft =>
  ({ key, value: 0, status: "missing", evidence: [], uncovered, hint, reason: null });
/** The JD gives nothing to match against: left out, the other weights rescale. */
const dropped = (key: FitPartKey, reason: string): Draft =>
  ({ key, value: 0, status: "dropped", evidence: [], uncovered: [], hint: null, reason });

const NO_ITEMS_HINT = "Add projects or experience to your resume, or connect GitHub.";

export function levelGap(user: EngineeringLevel | null, jd: EngineeringLevel | null, config: JdFitConfig = JD_FIT_CONFIG): LevelGap {
  if (user === null || jd === null) return "unknown";
  const diff = ENGINEERING_LEVELS.indexOf(jd) - ENGINEERING_LEVELS.indexOf(user);
  return diff >= config.levelGap ? "stretch" : diff <= -config.levelGap ? "below" : "none";
}

export function scoreJdFit(profile: FitProfile, jd: FitJd, config: JdFitConfig = JD_FIT_CONFIG): FitResult {
  const weights = config.weights[jd.level ?? config.fallbackLevel];
  const parts: FitPart[] = [skillsPart(profile, jd, config), domainPart(profile, jd, config), rolePart(profile, jd, config), experiencePart(profile, jd, config), topicsPart(profile, jd, config)]
    .map((draft) => ({ ...draft, weight: weights[draft.key] }));
  const counted = parts.filter((p) => p.status !== "dropped");
  const total = counted.reduce((sum, p) => sum + p.weight, 0);
  const gap = levelGap(profile.level, jd.level, config);
  const cap = gap === "stretch" ? config.stretchCap : null;
  // A role below the user's level is a mismatch in itself, beyond what its experience range says.
  const diff = profile.level && jd.level ? ENGINEERING_LEVELS.indexOf(jd.level) - ENGINEERING_LEVELS.indexOf(profile.level) : 0;
  const levelFactor = diff === -1 ? config.belowLevelFactor.one : diff <= -2 ? config.belowLevelFactor.twoOrMore : null;
  let score = total > 0 ? Math.round((100 * (levelFactor ?? 1) * counted.reduce((sum, p) => sum + p.weight * p.value, 0)) / total) : null;
  if (score !== null && cap !== null) score = Math.min(score, cap);
  return { jdId: jd.id, score, levelGap: gap, cap, levelFactor, userLevel: profile.level, jdLevel: jd.level, configVersion: config.version, parts };
}

// --- skills ----------------------------------------------------------------------------------------

/** One JD stack entry: the skills that satisfy it ("JavaScript / TypeScript" is either). */
interface StackAsk { label: string; options: CanonicalSkill[] }

function stackAsks(techStack: string[]): StackAsk[] {
  const asks = new Map<string, StackAsk>();
  for (const term of techStack) {
    if (isNonSkillTerm(term)) continue;
    const options = canonicalSkills(term);
    const key = options.map((s) => s.id).sort().join("|");
    if (!asks.has(key)) asks.set(key, { label: term.trim(), options });
  }
  return [...asks.values()];
}

function skillsPart(p: FitProfile, jd: FitJd, c: JdFitConfig): Draft {
  const asks = stackAsks(jd.techStack);
  if (!asks.length) return dropped("skills", jd.techStack.length ? "This role's stack lists no skills, only assessments." : "This role lists no tech stack.");
  if (!p.items.length && !p.listedSkills.length && !p.githubLanguages.length && !p.preferredLanguage && !(p.totalSolved && p.totalSolved.count > 0)) {
    return missing("skills", "Add your skills and projects to your resume, or connect GitHub.", asks.map((a) => a.label));
  }
  let credit = 0;
  const evidence: FitEvidence[] = [], uncovered: string[] = [];
  for (const ask of asks) {
    // The best alternative wins; a used skill beats a listed one.
    const best = ask.options.map((skill) => skillCredit(p, skill, c)).filter((x): x is { credit: number; evidence: FitEvidence } => x !== null).sort((a, b) => b.credit - a.credit)[0];
    if (!best) { uncovered.push(ask.label); continue; }
    credit += best.credit;
    evidence.push({ ...best.evidence, tag: ask.label });
  }
  return scored("skills", credit / asks.length, evidence, uncovered);
}

/** Full credit for a skill used anywhere (or one that implies it), half for one only listed on the resume. */
function skillCredit(p: FitProfile, skill: CanonicalSkill, c: JdFitConfig): { credit: number; evidence: FitEvidence } | null {
  const implied = skill.impliedBy.map(skillById).filter((s): s is CanonicalSkill => s !== null);
  const used = usedEvidence(p, skill) ?? implied.map((s) => via(usedEvidence(p, s), s)).find((e) => e !== null) ?? null;
  if (used) return { credit: c.skillCredit.used, evidence: used };
  // Work in a role that uses the skill by definition: a job counts in full, a project at the project rate.
  const role = roleEvidence(p, skill, c);
  if (role) return role;
  const listed = listedEvidence(p, skill) ?? implied.map((s) => via(listedEvidence(p, s), s)).find((e) => e !== null) ?? null;
  return listed ? { credit: c.skillCredit.listed, evidence: listed } : null;
}

const via = (e: FitEvidence | null, s: CanonicalSkill): FitEvidence | null => (e ? { ...e, matched: `${e.matched} (shows ${s.label})` } : null);

/** Work in a role family that uses the skill by definition (HTTP for any backend or frontend engineer). Items are ordered jobs first. */
function roleEvidence(p: FitProfile, skill: CanonicalSkill, c: JdFitConfig): { credit: number; evidence: FitEvidence } | null {
  if (!skill.impliedByRoles.length) return null;
  for (const item of p.items) {
    const hit = item.roles.find((r) => skill.impliedByRoles.includes(r.tag));
    if (hit) return { credit: c.skillCredit.used * c.itemCredit[item.kind], evidence: { source: item.source, item: item.title, matched: `${hit.tag} work ("${hit.matched}")`, tag: skill.label } };
  }
  return null;
}

function listedEvidence(p: FitProfile, skill: CanonicalSkill): FitEvidence | null {
  const listed = matchInList(p.listedSkills, skill);
  return listed ? { source: "resume", item: "Resume skills list (listed only, half credit)", matched: listed, tag: skill.label } : null;
}

/** Where the profile shows the skill in use: a job, internship, project or repo, a GitHub language, or the LeetCode language. */
function usedEvidence(p: FitProfile, skill: CanonicalSkill): FitEvidence | null {
  for (const item of p.items) {
    const matched = matchInList(item.tech, skill) ?? matchInText(item.text, skill);
    if (matched) return { source: item.source, item: item.title, matched, tag: skill.label };
  }
  const language = matchInList(p.githubLanguages, skill);
  if (language) return { source: "github", item: "GitHub languages", matched: language, tag: skill.label };
  const preferred = p.preferredLanguage ? matchInList([p.preferredLanguage], skill) : null;
  if (preferred) return { source: "leetcode", item: "LeetCode preferred language", matched: preferred, tag: skill.label };
  // "Data structures" / "Algorithms" / "DSA" in a stack is shown by solving problems.
  if (skill.id === "data-structures" && p.totalSolved && p.totalSolved.count > 0) {
    return { source: p.totalSolved.source, item: p.totalSolved.name, matched: `${p.totalSolved.count} solved`, tag: skill.label };
  }
  return null;
}

// --- domain and role -------------------------------------------------------------------------------

/** Best matching item wins (a job beats a project); the same project on resume and GitHub never adds up. */
function itemTags(key: "domain" | "role", p: FitProfile, wanted: string[], label: string, c: JdFitConfig): Draft {
  const hits = p.items.flatMap((item) => {
    const hit: TagHit | undefined = (key === "domain" ? item.domains : item.roles).find((h) => wanted.includes(h.tag));
    return hit ? [{ item, hit, credit: c.itemCredit[item.kind] }] : [];
  }).sort((a, b) => b.credit - a.credit);
  const evidence = hits.slice(0, c.maxEvidence).map(({ item, hit }) => ({ source: item.source, item: item.title, matched: hit.matched, tag: hit.tag }));
  return scored(key, hits[0]?.credit ?? 0, evidence, hits.length ? [] : [label]);
}

/** The company's sector, or for a generic one, the domains the JD's own text names. */
function domainPart(p: FitProfile, jd: FitJd, c: JdFitConfig): Draft {
  const { tags } = jdDomains(jd.sector, jd.text);
  if (!tags.length) {
    const generic = jd.sector !== null && (GENERIC_SECTORS as readonly string[]).includes(jd.sector.trim().toLowerCase());
    return dropped("domain", generic
      ? "This company's sector is general and the role's description names no specific domain, so the domain isn't scored."
      : "This company has no sector on record and the role's description names no specific domain.");
  }
  const wanted = tags.map((t) => t.tag), label = wanted.join(", ");
  if (!p.items.length) return missing("domain", NO_ITEMS_HINT, wanted);
  return itemTags("domain", p, wanted, label, c);
}

/** A missing specialization or a hiring-track name (TCS Ninja, Accenture ASE) is a generalist role: any software work counts. */
function rolePart(p: FitProfile, jd: FitJd, c: JdFitConfig): Draft {
  const { tags, generalist } = jdRoles(jd.specialization);
  const label = generalist ? "software engineering" : jd.specialization!.trim();
  if (!p.items.length) return missing("role", NO_ITEMS_HINT, [label]);
  return itemTags("role", p, [...tags], label, c);
}

// --- experience ------------------------------------------------------------------------------------

/**
 * Full-time years vs the JD's range (or its level's default band). Under the minimum falls to 0;
 * over the maximum falls softly to a floor (over-qualification is a weaker mismatch than
 * under-qualification). Never `missing`: no experience is 0 years.
 */
function experiencePart(p: FitProfile, jd: FitJd, c: JdFitConfig): Draft {
  const band: readonly [number, number | null] | null = jd.yoeMin !== null || jd.yoeMax !== null ? [jd.yoeMin ?? 0, jd.yoeMax] : jd.level ? c.levelBands[jd.level] : null;
  if (band === null) return dropped("experience", "This role lists no experience range or level.");
  const [min, max] = band;
  const years = p.fullTimeMonths / 12;
  const asked = max === null ? `${fmt(min)}+ yrs` : min === max ? `${fmt(min)} yrs` : `${fmt(min)}–${fmt(max)} yrs`;
  let value: number, gap: string | null = null;
  if (years < min) {
    value = c.experienceRampYears > 0 ? 1 - (min - years) / c.experienceRampYears : 0;
    gap = `${asked} of full-time experience`;
  } else if (max !== null && years > max) {
    const span = Math.max(max, c.overqualifiedSpanMinYears);
    value = 1 - (1 - c.overqualifiedFloor) * Math.min(1, (years - max) / span);
    gap = `more than the ${asked} asked`;
  } else {
    value = 1;
  }
  return scored("experience", value, [{ source: "resume", item: "Full-time experience", matched: `${fmt(Math.round(years * 10) / 10)} yrs`, tag: `${asked} asked` }], gap ? [gap] : []);
}

// --- round topics ----------------------------------------------------------------------------------

const GENERAL_DSA = "general-dsa";
const GENERAL_DSA_LABEL = "General DSA";
const topicName = (tag: string) => (tag === GENERAL_DSA ? GENERAL_DSA_LABEL : topicLabel(tag));

/**
 * Specific DSA topics are scored per topic; a broad ask ("Data structures", or a DSA round naming no
 * specific topic) is one "General DSA" topic scored on total problems solved. Each target comes
 * from the hardest round that asks for it.
 */
function topicsPart(p: FitProfile, jd: FitJd, c: JdFitConfig): Draft {
  const targets = new Map<string, number>();
  const ask = (tag: string, target: number) => targets.set(tag, Math.max(targets.get(tag) ?? 0, target));
  for (const round of jd.rounds) {
    // "Queues" in a system-design round is messaging, not the data structure: only coding rounds ask DSA.
    if (!isCodingRound(round.type)) continue;
    const d = round.difficulty?.trim().toLowerCase();
    const difficulty = d === "easy" || d === "hard" ? d : "medium";
    const dsaRound = round.type?.trim().toLowerCase() === "dsa";
    const specific = dsaRound ? round.topics.flatMap((topic) => roundTopicTags(topic)) : [];
    const topicTarget = Math.max(c.topicTargets[difficulty], jd.level ? c.topicLevelFloor[jd.level] : 0);
    for (const tag of specific) ask(tag, topicTarget);
    const broad = round.topics.some(isGeneralDsaTopic) || (dsaRound && !specific.length);
    if (broad) ask(GENERAL_DSA, Math.max(c.generalDsaTargets[difficulty], jd.level ? c.generalDsaLevelFloor[jd.level] : 0));
  }
  if (!targets.size) return dropped("round_topics", "This role's rounds have no DSA or coding round.");
  const labels = [...targets.keys()].map(topicName);
  if (!p.hasTopicSource) return missing("round_topics", `Connect LeetCode, Codeforces or TUF to show coverage of ${labels.slice(0, 3).join(", ")}.`, labels);
  let sum = 0;
  const evidence: FitEvidence[] = [], uncovered: string[] = [];
  for (const [tag, target] of targets) {
    const best = tag === GENERAL_DSA ? p.totalSolved : p.topics[tag];
    const solved = best?.count ?? 0;
    sum += Math.min(solved / target, 1);
    if (best && solved > 0) evidence.push({ source: best.source, item: best.name, matched: `${solved}/${target} solved`, tag: topicName(tag) });
    else uncovered.push(topicName(tag));
  }
  return scored("round_topics", sum / targets.size, evidence, uncovered);
}
