import { createHash } from "node:crypto";
import type { CompanyRow, JobDescriptionRow } from "../db/pg/schema.js";
import type { EnrichmentDocument, EnrichmentRole } from "../domain/enrichment.js";
import { ROUND_TYPES } from "../domain/enums.js";
import { engineeringLevelView } from "../domain/engineeringLevels.js";

type ObjectValue = Record<string, unknown>;
const obj = (v: unknown): ObjectValue => v !== null && typeof v === "object" && !Array.isArray(v) ? v as ObjectValue : {};
const simulated = (v: unknown) => ["template", "practice_template", "custom_practice"].includes(String(obj(v).provenance));
// Only the supported company/role fields below are read. Candidate profiles, arbitrary metadata,
// unverified claims and inferred/template fields are never copied into the editor.
const value = (v: unknown): unknown => {
  const o = obj(v);
  return simulated(o) || ["unavailable", "inferred_from_similar"].includes(String(o.provenance)) ? null : "value" in o ? o.value : v;
};
const str = (v: unknown, max = 10000): string => typeof value(v) === "string" ? (value(v) as string).trim().slice(0, max).trim() : "";
const list = (v: unknown): unknown[] => Array.isArray(value(v)) ? value(v) as unknown[] : [];
const texts = (v: unknown, max = 255, count = 50): string[] => [...new Set(list(v).map((x) => str(x, max)).filter(Boolean))].slice(0, count);
const number = (v: unknown, max: number): number | null => {
  const n = value(v);
  const parsed = typeof n === "number" ? n : typeof n === "string" && /^\d+(\.\d+)?$/.test(n.trim()) ? Number(n) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= max ? parsed : null;
};
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function safeSourceUrls(...inputs: unknown[]): string[] {
  const urls = inputs.flatMap((v) => Array.isArray(v) ? v : [v]).filter((v): v is string => typeof v === "string").map((s) => s.trim());
  return [...new Set(urls.filter((s) => {
    if (s.length > 2048 || !/^https?:\/\//i.test(s) || /[\s\u0000-\u001f\u007f]/.test(s)) return false;
    try { const u = new URL(s); return !!u.hostname && !u.username && !u.password; } catch { return false; }
  }))].slice(0, 20);
}

function sources(...fields: unknown[]): string[] {
  return safeSourceUrls(...fields.flatMap((f) => {
    const o = obj(f);
    return [o.source_urls, o.sourceUrls, o.evidence_urls, o.sources, o.sourceUrl, o.url].flatMap((v) => Array.isArray(v) ? v : [v]);
  }));
}

/** Deterministic UUIDs survive retries and later imports without a new persistence column. */
function stableId(scope: string, key: string): string {
  const hex = createHash("sha256").update(`${scope}\0${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function join(parts: string[], max: number): string {
  const kept: string[] = [];
  for (const part of parts.filter(Boolean)) {
    if (!kept.some((p) => norm(p).includes(norm(part)))) kept.push(part);
  }
  return kept.join("\n\n").slice(0, max).trim();
}

export function companyPrefill(company: CompanyRow, snapshot: unknown): EnrichmentDocument["company"] {
  const s = obj(snapshot), identity = obj(s.identity), p = obj(s.profile), c = obj(s.compensation);
  const overview = str(p.overview) || str(identity.overview);
  const known = (field: unknown, stored: unknown): unknown => blank(value(field)) ? stored : field;
  const facts: [string, unknown][] = [
    ["Company", known(identity.name, company.name)], ["Sector", known(p.sector, company.sector)],
    ["Business model", known(p.business_model, company.businessModel)], ["Headquarters", known(p.hq, company.headquarterLocation)],
    ["Headcount", known(p.headcount_band, company.headcountBand)], ["Revenue", known(p.revenue_band, company.revenueBand)],
    ["Funding stage", known(p.funding_stage, company.fundingStage)], ["Funding round", p.funding_round],
    ["Founded", p.founded_year], ["Products", p.products],
  ];
  const parts = [overview];
  for (const [label, raw] of facts) {
    const v = str(raw, 1000) || (typeof value(raw) === "number" ? String(value(raw)) : texts(raw).join(", "));
    if (v && !parts.some((part) => norm(part).includes(norm(v)))) parts.push(`${label}: ${v}`);
  }
  const quotes = list(c.review_quotes).length ? list(c.review_quotes) : company.reviewQuotes;
  const cultureFields = [c.review_summary, p.culture, c.culture];
  const benefitFields = [p.benefits, c.benefits, s.benefits];
  return {
    overview: join(parts, 10000),
    culture: join([str(c.review_summary) || company.reviewSummary || "", str(p.culture), str(c.culture),
      ...quotes.slice(0, 20).map((q) => str(obj(q).text) ? `“${str(obj(q).text)}”` : "")], 10000),
    benefits: join(benefitFields.flatMap((f) => str(f) ? [str(f)] : texts(f, 2000, 30)), 10000),
    sourceUrls: safeSourceUrls(value(identity.website), company.website, sources(...facts.map(([, v]) => v), p.overview,
      identity.overview, ...cultureFields, ...benefitFields, ...quotes, c.review_quotes, identity.website)),
    verified: false,
  };
}

function emptyRole(id: string): EnrichmentRole {
  return { id, jdId: null, title: "", role: "", level: "fresher", specialization: null, description: "", techStack: [],
    yoeMin: null, yoeMax: null, ctcMinLpa: null, ctcMaxLpa: null, sourceUrls: [], verified: false, rounds: [] };
}

function validRanges(role: EnrichmentRole): void {
  for (const [low, high] of [["yoeMin", "yoeMax"], ["ctcMinLpa", "ctcMaxLpa"]] as const) {
    if (role[low] !== null && role[high] !== null && role[low]! > role[high]!) role[low] = role[high] = null;
  }
}

export function jdPrefill(j: JobDescriptionRow): EnrichmentRole {
  const r = { ...emptyRole(j.id), jdId: j.id, title: str(j.title, 255), role: str(j.role, 255), ...engineeringLevelView(j.level),
    specialization: str(j.specialization, 32) || null, description: str(j.description, 20000),
    techStack: texts(j.techStack?.split(",")), yoeMin: number(j.yoeMin, 99.9), yoeMax: number(j.yoeMax, 99.9),
    ctcMinLpa: number(j.ctcMinLpa, 9999.99), ctcMaxLpa: number(j.ctcMaxLpa, 9999.99), sourceUrls: safeSourceUrls(j.sourceUrl) };
  validRanges(r);
  return r;
}

/** Complete, supported rounds become editable rows. Everything else remains a quoted reference:
 * the strict round schema cannot represent an unknown duration, difficulty or unsupported OA. */
export function addProcess(role: EnrichmentRole, process: unknown, sourceFields: unknown[] = []): void {
  const p = value(process), o = obj(p);
  if (simulated(process) || sourceFields.some(simulated) || o.template_used === true) return;
  const rounds = Array.isArray(p) ? p : list(o.rounds);
  const references: string[] = [];
  if (typeof p === "string") references.push(p.trim());
  const parentSources = sources(process, o, ...sourceFields);
  for (const [index, input] of rounds.slice(0, 50).entries()) {
    if (simulated(input)) continue;
    const r = obj(value(input));
    const name = str(r.name ?? r.title, 255), type = str(r.type ?? r.round_type, 255).toLowerCase();
    const duration = number(r.duration_minutes ?? r.durationMinutes, 240);
    const difficulty = str(r.difficulty, 255).toLowerCase();
    const topics = texts(r.topics, 255, 30), questions = texts(r.problems ?? r.questions, 2000, 30);
    const guidance = str(r.format ?? r.guidance ?? r.description);
    role.sourceUrls = safeSourceUrls(role.sourceUrls, sources(r));
    if (name && (ROUND_TYPES as readonly string[]).includes(type)
        && duration !== null && duration >= 1 && Number.isInteger(duration) && ["easy", "medium", "hard"].includes(difficulty)
        && role.rounds.length < 12) {
      const id = stableId(role.id, `round:${index}:${norm(name)}:${type}`);
      if (!role.rounds.some((existing) => existing.id === id)) role.rounds.push({ id, name, type: type as typeof ROUND_TYPES[number],
        durationMinutes: duration, difficulty: difficulty as "easy" | "medium" | "hard", topics, questions, guidance,
        sourceUrls: safeSourceUrls(sources(r, r.topics, r.problems, r.questions, r.format), parentSources), verified: false });
    } else {
      const description = [name, type, duration === null ? "" : `${duration} minutes`, difficulty, guidance,
        topics.length ? `Topics: ${topics.join(", ")}` : "", ...questions].filter(Boolean).join(" · ");
      if (description) references.push(description);
    }
  }
  if (references.length) role.description = join([role.description, ...references.map((r) => `Interview process reference (unverified): “${r}”`)], 20000);
  role.sourceUrls = safeSourceUrls(role.sourceUrls, parentSources);
}

export function researchRoles(companyId: string, snapshot: unknown, jds: JobDescriptionRow[]): EnrichmentRole[] {
  const result: EnrichmentRole[] = [];
  for (const raw of list(obj(snapshot).roles).slice(0, 100)) {
    if (simulated(raw)) continue;
    const r = obj(raw), title = str(r.title, 255);
    if (!title) continue;
    const key = str(r.role_key, 128) || [norm(title), norm(str(r.role)), norm(str(r.level)), norm(str(r.specialization)), norm(str(r.employment_type))].join(":");
    const linked = jds.find((j) => j.source !== "template" && j.roleKey && j.roleKey === str(r.role_key));
    const role = { ...emptyRole(stableId(companyId, `role:${key}`)), title, role: str(r.role, 255),
      ...engineeringLevelView(value(r.level)), specialization: str(r.specialization, 32) || null, description: str(r.jd ?? r.description, 20000),
      techStack: texts(r.tech_stack ?? r.techStack), yoeMin: number(r.yoe_min, 99.9), yoeMax: number(r.yoe_max, 99.9),
      ctcMinLpa: number(r.ctc_min_lpa, 9999.99), ctcMaxLpa: number(r.ctc_max_lpa, 9999.99),
      sourceUrls: sources(r, ...["title", "level", "specialization", "jd", "tech_stack", "yoe_min", "yoe_max", "ctc_min_lpa", "ctc_max_lpa"].map((k) => r[k])),
      ...(linked ? { jdId: linked.id } : {}),
    };
    validRanges(role);
    addProcess(role, r.interview_process);
    for (const report of list(r.reported_interview_process).slice(0, 20)) {
      const q = obj(report);
      addProcess(role, q.text ?? q.quote ?? q.passage, [q]);
    }
    result.push(role);
  }
  return result;
}

const blank = (v: unknown) => v == null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length);

function fill<T extends object>(target: T, source: T, keys: (keyof T)[]): boolean {
  let changed = false;
  for (const key of keys) if (blank(target[key]) && !blank(source[key])) {
    target[key] = structuredClone(source[key]);
    changed = true;
  }
  return changed;
}

function fillSources(target: { sourceUrls: string[] }, source: { sourceUrls: string[] }, contentChanged: boolean): void {
  if (contentChanged) target.sourceUrls = safeSourceUrls(target.sourceUrls, source.sourceUrls);
  else fill(target, source, ["sourceUrls"]);
}

function sameRole(a: EnrichmentRole, b: EnrichmentRole): boolean {
  if (a.jdId && b.jdId && a.jdId !== b.jdId) return false;
  // Sparse snapshots may lack a level/role. Match titles only when all known identity facts agree.
  return !!a.title && norm(a.title) === norm(b.title)
    && (["role", "level", "specialization"] as const).every((k) => blank(a[k]) || blank(b[k]) || norm(a[k]!) === norm(b[k]!));
}

export function fillRole(target: EnrichmentRole, source: EnrichmentRole): void {
  if (target.verified) return;
  let changed = fill(target, source, ["title", "description", "techStack"]);
  // Never adopt/change a saved role's JD identity during an import.
  if (!target.jdId) {
    changed = fill(target, source, ["role", "specialization"]) || changed;
    // An unknown historical label needs an explicit selection, never a guessed import repair.
    if (!target.legacyLevel) changed = fill(target, source, ["level"]) || changed;
  }
  for (const [low, high] of [["yoeMin", "yoeMax"], ["ctcMinLpa", "ctcMaxLpa"]] as const) {
    const min = target[low] ?? source[low], max = target[high] ?? source[high];
    if (min === null || max === null || min <= max) {
      changed = target[low] !== min || target[high] !== max || changed;
      target[low] = min; target[high] = max;
    }
  }
  if (!target.rounds.length && source.rounds.length) {
    target.rounds = structuredClone(source.rounds);
    changed = true;
  }
  else for (const round of target.rounds) {
    if (round.verified) continue;
    const match = source.rounds.find((r) => r.id === round.id || (norm(r.name) === norm(round.name) && r.type === round.type));
    if (match) {
      const roundChanged = fill(round, match, ["name", "topics", "questions", "guidance"]);
      fillSources(round, match, roundChanged);
      changed = roundChanged || changed;
    }
  }
  fillSources(target, source, changed);
}

export function mergePrefill(existing: EnrichmentDocument, incoming: EnrichmentDocument): EnrichmentDocument {
  const result = structuredClone(existing);
  if (!result.company.verified) {
    const changed = fill(result.company, incoming.company, ["overview", "culture", "benefits"]);
    fillSources(result.company, incoming.company, changed);
  }
  for (const role of incoming.roles) {
    const byId = result.roles.find((r) => r.id === role.id || (r.jdId && r.jdId === role.jdId));
    const matches = result.roles.filter((r) => sameRole(r, role));
    const match = byId ?? (matches.length === 1 ? matches[0] : undefined);
    if (match) fillRole(match, role);
    else if (result.roles.length < 50 && !matches.length) result.roles.push(structuredClone(role));
  }
  return result;
}
