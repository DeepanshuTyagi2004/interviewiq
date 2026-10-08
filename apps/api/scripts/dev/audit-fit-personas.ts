/**
 * Score every JD-fit persona against every visible JD through the real service and check the matrix
 * for fairness: shape invariants, level gaps, specialization and domain relevance, strength order
 * within a level, experience, and dictionary gaps (uncovered stack items and topics).
 *
 *   pnpm exec tsx --env-file=.env scripts/dev/audit-fit-personas.ts --out=/path/to/dir
 *
 * Writes <out>/fit-audit.md (the report) and <out>/fit-audit.json (every result). Read only.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { CompanyRow, JobDescriptionRow } from "../../src/db/pg/schema.js";
import { ENGINEERING_LEVELS, normalizeLegacyLevel, type EngineeringLevel } from "../../src/domain/engineeringLevels.js";
import type { FitPart, FitResult } from "../../src/domain/jdFit/types.js";
import { isHiddenCompany } from "../../src/services/jdCatalogue.js";
import { withContainer } from "./bootstrap.js";
import { FIT_PERSONAS, personaEmail, type FitPersona } from "./fitPersonas.js";

interface Scored { persona: FitPersona; userId: string; results: Map<string, FitResult> }
interface Issue { check: string; persona: string; detail: string }
type JdMeta = JobDescriptionRow & { sector: string | null; isTemplate: boolean; lvl: EngineeringLevel | null };

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const r1 = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : "—");
const part = (r: FitResult, key: FitPart["key"]) => r.parts.find((p) => p.key === key)!;
const partsText = (r: FitResult) => r.parts.map((p) => `${p.key[0]!.toUpperCase()}${p.status === "dropped" ? "–" : p.status === "missing" ? "×" : p.value.toFixed(2).replace(/^0/, "")}`).join(" ");
const idx = (level: EngineeringLevel | null) => (level ? ENGINEERING_LEVELS.indexOf(level) : -1);

async function main(): Promise<void> {
  const outArg = process.argv.slice(2).find((a) => a.startsWith("--out="));
  const outDir = resolve(outArg ? outArg.slice(6) : ".fit-audit");
  mkdirSync(outDir, { recursive: true });

  const { jds, scored } = await withContainer(async (c) => {
    const companies = await c.repos.companies.findAll();
    const visible = new Map(companies.filter((co) => !isHiddenCompany(co)).map((co) => [co.slug, co] as [string, CompanyRow]));
    const rows = (await c.repos.jds.findAllActiveOrdered()).filter((j) => visible.has(j.company));
    const jds = new Map(rows.map((j) => [j.id, { ...j, sector: visible.get(j.company)!.sector, isTemplate: j.source === "template", lvl: normalizeLegacyLevel(j.level) } as JdMeta]));
    const scored: Scored[] = [];
    for (const persona of FIT_PERSONAS) {
      const user = await c.repos.users.findByEmailInsensitive(personaEmail(persona));
      if (!user) throw new Error(`${personaEmail(persona)} is not seeded; run seed-fit-personas.ts --apply first`);
      const results = await c.jdFit.all(user.id, { company: null, level: null, specialization: null });
      scored.push({ persona, userId: user.id, results: new Map(results.map((r) => [r.jdId, r])) });
      process.stderr.write(`scored ${persona.slug}: ${results.length} JDs\n`);
    }
    return { jds, scored };
  });

  const issues: Issue[] = [];
  const flag = (check: string, persona: string, detail: string) => issues.push({ check, persona, detail });
  const ownLevel = (s: Scored) => [...s.results.values()].filter((r) => jds.get(r.jdId)!.lvl === s.persona.level);
  const specOf = (r: FitResult) => jds.get(r.jdId)!.specialization ?? "none";

  // A. Shape invariants on every result.
  for (const s of scored) for (const r of s.results.values()) {
    const j = jds.get(r.jdId)!, who = `${s.persona.slug} × ${j.company}/${j.title}`;
    if (r.score !== null && (!Number.isInteger(r.score) || r.score < 0 || r.score > 100)) flag("shape", s.persona.slug, `${who}: score ${r.score}`);
    const counted = r.parts.filter((p) => p.status !== "dropped");
    if (r.score === null && counted.length) flag("shape", s.persona.slug, `${who}: null score with ${counted.length} counted parts`);
    for (const p of r.parts) {
      if (p.value < 0 || p.value > 1) flag("shape", s.persona.slug, `${who}: ${p.key} value ${p.value}`);
      if (p.status === "scored" && p.value > 0 && !p.evidence.length) flag("shape", s.persona.slug, `${who}: ${p.key}=${p.value} without evidence`);
      if (p.status === "missing" && !p.hint) flag("shape", s.persona.slug, `${who}: ${p.key} missing without hint`);
      if (p.status === "dropped" && !p.reason) flag("shape", s.persona.slug, `${who}: ${p.key} dropped without reason`);
      if (p.status === "scored" && p.value === 1 && (p.key === "skills" || p.key === "round_topics") && p.uncovered.length) flag("shape", s.persona.slug, `${who}: ${p.key} full but uncovered ${p.uncovered.join(", ")}`);
    }
    // B. Level gap and cap.
    const diff = idx(j.lvl) - idx(s.persona.level);
    const expected = j.lvl === null ? "unknown" : diff >= 2 ? "stretch" : diff <= -2 ? "below" : "none";
    if (r.levelGap !== expected) flag("levelGap", s.persona.slug, `${who}: ${r.levelGap}, expected ${expected}`);
    if ((r.cap !== null) !== (r.levelGap === "stretch")) flag("levelGap", s.persona.slug, `${who}: cap ${r.cap} with gap ${r.levelGap}`);
    if (r.cap !== null && r.score !== null && r.score > r.cap) flag("levelGap", s.persona.slug, `${who}: score ${r.score} above cap ${r.cap}`);
    const expectedFactor = j.lvl === null ? null : diff === -1 ? 0.85 : diff <= -2 ? 0.7 : null;
    if (r.levelFactor !== expectedFactor) flag("levelGap", s.persona.slug, `${who}: levelFactor ${r.levelFactor}, expected ${expectedFactor}`);
  }

  // C. Specialization relevance at the persona's own level (templates only: same structure everywhere).
  const specMeans = new Map<string, Map<string, number>>();
  for (const s of scored) {
    const bySpec = new Map<string, number[]>();
    for (const r of ownLevel(s).filter((r) => jds.get(r.jdId)!.isTemplate && r.score !== null)) (bySpec.get(specOf(r)) ?? bySpec.set(specOf(r), []).get(specOf(r))!).push(r.score!);
    const means = new Map([...bySpec].map(([k, v]) => [k, mean(v)]));
    specMeans.set(s.persona.slug, means);
    const want = s.persona.expectedSpecialization;
    if (want && means.has(want)) {
      const top = [...means].sort((a, b) => b[1] - a[1])[0]!;
      if (top[0] !== want && top[1] > means.get(want)! + 0.5) flag("specialization", s.persona.slug, `expected ${want} (${r1(means.get(want)!)}) to lead at ${s.persona.level}, but ${top[0]} leads (${r1(top[1])}); all: ${[...means].map(([k, v]) => `${k} ${r1(v)}`).join(", ")}`);
    }
  }

  // D. Strength order within a level: a stronger tier should win most own-level JDs in its own lane
  // (its specialization's templates and the generalist company tracks), not an ML persona's ML JDs.
  const TEMPLATE_SPECS = ["backend", "frontend", "fullstack", "data-science", "ai-ml", "devops"];
  const inLane = (a: Scored, id: string) => { const spec = jds.get(id)!.specialization; return !a.persona.expectedSpecialization || spec === a.persona.expectedSpecialization; };
  for (const level of ENGINEERING_LEVELS) {
    const group = scored.filter((s) => s.persona.level === level);
    for (const a of group) for (const b of group) {
      if (a.persona.tier >= b.persona.tier) continue;
      const ids = ownLevel(a).map((r) => r.jdId).filter((id) => b.results.has(id) && inLane(a, id));
      const wins = ids.filter((id) => (a.results.get(id)!.score ?? 0) >= (b.results.get(id)!.score ?? 0)).length;
      const share = ids.length ? wins / ids.length : 1;
      if (share < 0.8) flag("tier", a.persona.slug, `tier ${a.persona.tier} ${a.persona.slug} beats tier ${b.persona.tier} ${b.persona.slug} on only ${(share * 100).toFixed(0)}% of ${ids.length} ${level} JDs`);
    }
  }

  // E. Domain: at own level, matching-sector companies should score ≥ other specific sectors; generic ones identical.
  for (const s of scored) {
    const own = ownLevel(s).filter((r) => jds.get(r.jdId)!.isTemplate && r.score !== null);
    const specs = new Set(own.map(specOf));
    for (const spec of specs) {
      const rows = own.filter((r) => specOf(r) === spec);
      const match = rows.filter((r) => s.persona.expectedDomains.includes(jds.get(r.jdId)!.sector ?? "")).map((r) => r.score!);
      const other = rows.filter((r) => { const sec = jds.get(r.jdId)!.sector; return sec && !s.persona.expectedDomains.includes(sec) && !["it-services", "consumer-internet", "enterprise-software", "other"].includes(sec); }).map((r) => r.score!);
      if (match.length && other.length && mean(match) < mean(other)) flag("domain", s.persona.slug, `${spec}@${s.persona.level}: matching sectors ${r1(mean(match))} < other specific sectors ${r1(mean(other))}`);
      const generic = rows.filter((r) => ["it-services", "consumer-internet", "enterprise-software"].includes(jds.get(r.jdId)!.sector ?? ""));
      const distinct = new Set(generic.map((r) => `${r.score}|${part(r, "domain").status}`));
      if (distinct.size > 1) flag("domain", s.persona.slug, `${spec}@${s.persona.level}: generic-sector templates differ: ${generic.map((r) => `${jds.get(r.jdId)!.company} ${r.score}`).join(", ")}`);
    }
  }

  // F. Experience at own level should be a near-full fit for a persona at that level. A researched JD's
  // range can be narrower than the level band (CRED SDE-1 asks 0–2 years), so a small over-qualification
  // decay at the boundary is expected; only a real gap is flagged.
  for (const s of scored) {
    const bad = ownLevel(s).filter((r) => part(r, "experience").status === "scored" && part(r, "experience").value < 0.75);
    if (bad.length) { const e = part(bad[0]!, "experience").evidence[0]; flag("experience", s.persona.slug, `${bad.length} own-level JDs below full experience fit (${e?.matched} vs ${e?.tag}); e.g. ${jds.get(bad[0]!.jdId)!.company}/${jds.get(bad[0]!.jdId)!.title}`); }
  }

  // G. Distribution.
  for (const s of scored) {
    const xs = ownLevel(s).map((r) => r.score).filter((x): x is number => x !== null);
    const m = mean(xs);
    if (m > 90) flag("distribution", s.persona.slug, `own-level mean ${r1(m)} is near the ceiling`);
    if (s.persona.tier < 3 && m < 15) flag("distribution", s.persona.slug, `own-level mean ${r1(m)} is near the floor for a tier-${s.persona.tier} persona`);
  }

  // H. Dictionary gaps.
  const count = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
  const uncoveredSkills = new Map<string, number>(), uncoveredTopics = new Map<string, number>(), dropped = new Map<string, number>(), missing = new Map<string, number>();
  for (const s of scored) for (const r of s.results.values()) for (const p of r.parts) {
    if (p.status === "dropped") count(dropped, `${p.key}: ${p.reason}`);
    if (p.status === "missing") count(missing, `${p.key}: ${p.hint}`);
    if (p.status !== "scored") continue;
    if (p.key === "skills") for (const u of p.uncovered) count(uncoveredSkills, u);
    if (p.key === "round_topics") for (const u of p.uncovered) count(uncoveredTopics, u);
  }
  const top = (map: Map<string, number>, n: number) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `- ${v}× ${k}`).join("\n") || "- none";

  // ---- report
  const lines: string[] = ["# JD fit persona audit", "", `${scored.length} personas × ${jds.size} JDs (${[...jds.values()].filter((j) => j.isTemplate).length} templates, ${[...jds.values()].filter((j) => !j.isTemplate).length} researched). Parts: S skills, D domain, R role, E experience, T round topics; × missing, – dropped.`, ""];
  lines.push("## Checks", "", `${issues.length} issue(s).`, "");
  for (const check of [...new Set(issues.map((i) => i.check))]) {
    lines.push(`### ${check} (${issues.filter((i) => i.check === check).length})`, "");
    for (const i of issues.filter((i) => i.check === check).slice(0, 40)) lines.push(`- **${i.persona}** — ${i.detail}`);
    lines.push("");
  }
  lines.push("## Own-level mean score by persona", "", "| Level | Persona | Tier | Mean | Min | Max | Templates by specialization |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const s of scored) {
    const xs = ownLevel(s).map((r) => r.score).filter((x): x is number => x !== null);
    lines.push(`| ${s.persona.level} | ${s.persona.name} | ${s.persona.tier} | ${r1(mean(xs))} | ${Math.min(...xs)} | ${Math.max(...xs)} | ${[...(specMeans.get(s.persona.slug) ?? [])].map(([k, v]) => `${k} ${r1(v)}`).join(" · ")} |`);
  }
  lines.push("", "## Dictionary gaps", "", "### Uncovered stack items (persona × JD occurrences)", top(uncoveredSkills, 40), "", "### Uncovered round topics", top(uncoveredTopics, 25), "", "### Dropped parts", top(dropped, 15), "", "### Missing parts", top(missing, 15), "");
  for (const s of scored) {
    const p = s.persona;
    lines.push(`## ${p.name} — ${p.level}, tier ${p.tier}`, "", `_${p.probe}_`, "");
    const own = ownLevel(s);
    const manual = own.filter((r) => !jds.get(r.jdId)!.isTemplate);
    lines.push("Researched JDs at own level:", "");
    for (const r of manual.sort((a, b) => (b.score ?? -1) - (a.score ?? -1))) { const j = jds.get(r.jdId)!; lines.push(`- ${String(r.score).padStart(3)} ${j.company} · ${j.title} (${j.specialization ?? "no spec"}) · ${partsText(r)}`); }
    if (!manual.length) lines.push("- none");
    lines.push("", "Templates at own level (score by company):", "");
    const specs = [...new Set(own.filter((r) => jds.get(r.jdId)!.isTemplate).map(specOf))];
    for (const spec of specs) {
      const rows = own.filter((r) => jds.get(r.jdId)!.isTemplate && specOf(r) === spec).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
      lines.push(`- ${spec}: ${rows.map((r) => `${jds.get(r.jdId)!.company} ${r.score}`).join(", ")}`);
      lines.push(`  - parts (best): ${partsText(rows[0]!)}`);
    }
    const all = [...s.results.values()].filter((r) => r.score !== null).sort((a, b) => b.score! - a.score!);
    lines.push("", "Top 6 overall:", "", ...all.slice(0, 6).map((r) => { const j = jds.get(r.jdId)!; return `- ${r.score} ${j.company} · ${j.title} [${j.lvl}, ${r.levelGap}] · ${partsText(r)}`; }));
    const uncovered = new Map<string, number>();
    for (const r of own) for (const u of part(r, "skills").uncovered) count(uncovered, u);
    lines.push("", `Uncovered stack items at own level: ${[...uncovered].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k} (${v})`).join(", ") || "none"}`, "");
  }
  writeFileSync(resolve(outDir, "fit-audit.md"), lines.join("\n"));
  writeFileSync(resolve(outDir, "fit-audit.json"), JSON.stringify({ generatedAt: new Date().toISOString(), issues, personas: scored.map((s) => ({ slug: s.persona.slug, userId: s.userId, results: [...s.results.values()] })) }));
  console.log(`${issues.length} issue(s); report at ${resolve(outDir, "fit-audit.md")}`);
  for (const check of [...new Set(issues.map((i) => i.check))]) console.log(`  ${check}: ${issues.filter((i) => i.check === check).length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode = 1; });
}
