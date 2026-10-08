import type { Blueprint, BlueprintSlot } from "@/features/blueprints";
import { asRecords, asString, asStrings, isRecord } from "../format";
import { roundLabel } from "../vocabulary";

/** A readable Markdown rendering of a blueprint, for review outside the console. */

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const bullets = (items: readonly string[]) => (items.length ? items.map((x) => `- ${x}`).join("\n") : "- —");

function round(bp: Blueprint): string[] {
  const r = bp.round ?? {};
  const type = asString(r.type);
  return [
    `- **Round:** ${roundLabel(type)}${asString(r.name) ? ` (${asString(r.name)})` : ""}`,
    `- **Company / role / level:** ${[asString(r.company), asString(r.role), asString(r.level)].filter(Boolean).join(" · ") || "—"}`,
    `- **Duration:** ${typeof r.duration_mins === "number" ? `${r.duration_mins} min` : "—"}`,
    `- **Format:** ${asString(r.format) ?? "—"}`,
    `- **Source:** ${asString(r.source) ?? "—"}`,
    `- **Difficulty target:** ${asString(r.difficulty_target) ?? "—"}`,
  ];
}

function slot(s: BlueprintSlot): string[] {
  const out: string[] = [];
  out.push(`### ${s.kind} ${s.order} · ${s.problem.title}`);
  out.push("");
  out.push(`- **Slot:** ${s.slot_id} · ${s.timebox_mins} min${s.purpose ? ` · ${s.purpose}` : ""}`);
  out.push(`- **Problem:** ${s.problem.title} (\`${s.problem.slug}\`)${s.problem.difficulty ? ` · ${s.problem.difficulty}` : ""}`);
  out.push("");
  out.push("**Opening**");
  out.push("");
  out.push(`> ${s.ask.opening.replace(/\r?\n/g, "\n> ")}`);
  const clar = s.ask.clarifications ?? [];
  if (clar.length) {
    out.push("");
    out.push("**Clarifications**");
    out.push("");
    out.push(clar.map((c) => `- Q: ${c.question ?? "—"}\n  A: ${c.answer ?? "—"}`).join("\n"));
  }
  out.push("");
  out.push("**Hint ladder**");
  out.push("");
  out.push(s.hint_ladder.length ? s.hint_ladder.map((h, i) => `${h.step ?? i + 1}. ${h.hint ?? "—"}`).join("\n") : "- —");
  out.push("");
  out.push("**Branches**");
  out.push("");
  out.push("| Condition | Action | Say | Notes |");
  out.push("|---|---|---|---|");
  for (const b of s.branches) out.push(`| ${esc(b.condition)} | ${esc(b.action)} | ${esc(b.say)} | ${esc(b.notes ?? "")} |`);
  out.push("");
  out.push("**Probes**");
  out.push("");
  out.push(bullets(s.probes ?? []));
  out.push("");
  out.push("**Follow-ups**");
  out.push("");
  out.push(bullets(s.follow_ups ?? []));
  out.push("");
  out.push("**Expectations**");
  out.push("");
  out.push(`- Must show: ${(s.expectations.must_show ?? []).join("; ") || "—"}`);
  out.push(`- Strong signals: ${(s.expectations.strong_signals ?? []).join("; ") || "—"}`);
  out.push(`- Weak signals: ${(s.expectations.weak_signals ?? []).join("; ") || "—"}`);
  out.push("");
  out.push("**Evaluation signals**");
  out.push("");
  out.push(bullets(s.evaluation_signals.map((e) => `${e.signal ?? "—"}: ${e.observe ?? "—"}`)));
  const key = s.answer_key.key;
  if (key && Object.keys(key).length) {
    out.push("");
    out.push(`**Answer key** (${s.answer_key.cache_hit ? "cache hit" : "cache miss"}${s.answer_key.key_version ? `, ${s.answer_key.key_version}` : ""})`);
    out.push("");
    out.push(...answerKey(key));
  }
  return out;
}

function answerKey(k: Record<string, unknown>): string[] {
  const out: string[] = [];
  const approaches = asRecords(k.approaches);
  if (approaches.length) {
    out.push(...approaches.map((a, i) => `${i + 1}. ${asString(a.name) ?? "Approach"}: ${asString(a.idea) ?? ""} (time ${asString(a.time_complexity) ?? "—"}, space ${asString(a.space_complexity) ?? "—"})`));
  }
  const complexity = asString(k.complexity_target);
  if (complexity) out.push(`- Complexity target: ${complexity}`);
  const mustCover = asStrings(k.must_cover);
  if (mustCover.length) out.push(`- Must cover: ${mustCover.join("; ")}`);
  const insights = asStrings(k.key_insights);
  if (insights.length) out.push(`- Key insights: ${insights.join("; ")}`);
  const wrong = asRecords(k.common_wrong_paths);
  if (wrong.length) out.push(...wrong.map((w) => `- Wrong path: ${asString(w.path) ?? "—"} (why: ${asString(w.why_wrong) ?? "—"}; nudge: ${asString(w.nudge) ?? "—"})`));
  const edges = asStrings(k.edge_cases);
  if (edges.length) out.push(`- Edge cases: ${edges.join("; ")}`);
  const sol = isRecord(k.reference_solution) ? k.reference_solution : null;
  if (sol) {
    out.push("");
    out.push(`Reference solution (${asString(sol.language) ?? "python"}, ${sol.verified_against_examples === true ? "verified against examples" : "not verified"}):`);
    out.push("");
    out.push("```" + (asString(sol.language) ?? ""));
    out.push(asString(sol.code) ?? "");
    out.push("```");
  }
  return out;
}

export function blueprintToMarkdown(bp: Blueprint): string {
  const p = bp.persona;
  const pers = bp.personalization;
  const pol = bp.policies;
  const lines: string[] = [];
  lines.push(`# Interview blueprint v${bp.version} (${bp.status})`);
  lines.push("");
  lines.push(`Blueprint \`${bp.blueprint_id}\` · run \`${bp.run_id}\` · created ${bp.created_at}`);
  lines.push("");
  lines.push(...round(bp));
  lines.push("");
  lines.push("## What the candidate sees");
  lines.push("");
  lines.push(`- **Interviewer:** ${bp.briefing.interviewer_name}`);
  lines.push(`- **Style:** ${bp.briefing.interviewer_style}`);
  lines.push(`- **Format:** ${bp.briefing.format}`);
  lines.push(`- **Duration:** ${bp.briefing.duration_mins} min`);
  lines.push("");
  lines.push("## Persona");
  lines.push("");
  lines.push(`- **Name:** ${p.name ?? "—"}${p.seniority ? ` (${p.seniority})` : ""}`);
  lines.push(`- **Style:** ${p.style ?? "—"}`);
  lines.push(`- **Disposition:** ${p.disposition ?? "—"}`);
  lines.push(`- **Opening:** ${p.opening ?? "—"}`);
  lines.push(`- **Closing:** ${p.closing ?? "—"}`);
  lines.push(`- **Grounded in:** ${(p.grounded_in ?? []).join("; ") || "—"}`);
  lines.push("");
  lines.push("## Arc");
  lines.push("");
  lines.push("| Phase | Minutes | Scored | Guidance |");
  lines.push("|---|---|---|---|");
  for (const a of bp.arc) lines.push(`| ${a.phase ?? "—"} | ${a.timebox_mins ?? "—"} | ${a.scored ? "yes" : "no"} | ${esc(a.guidance ?? "")} |`);
  lines.push("");
  lines.push("## Personalization");
  lines.push("");
  lines.push("**Rapport hooks**");
  lines.push("");
  lines.push(bullets((pers.rapport_hooks ?? []).map((h) => `${h.line ?? "—"} _(source: ${h.source ?? "—"})_`)));
  lines.push("");
  lines.push("**Resume probes**");
  lines.push("");
  lines.push(bullets((pers.resume_probes ?? []).map((r) => `${r.prompt ?? "—"} _(grounded in: ${r.grounded_in ?? "—"}; tests: ${r.what_it_tests ?? "—"})_`)));
  lines.push("");
  if ((pers.round_questions ?? []).length) {
    lines.push("**Round questions**");
    lines.push("");
    lines.push(bullets((pers.round_questions ?? []).map((q) => `${q.prompt ?? "—"} _(covers: ${q.covers ?? "—"}; tests: ${q.what_it_tests ?? "—"})_`)));
    lines.push("");
  }
  lines.push(`**Level expectations:** ${pers.level_expectations ?? "—"}`);
  lines.push("");
  lines.push("## Slots");
  for (const s of [...bp.slots].sort((a, b) => (a.kind === b.kind ? a.order - b.order : a.kind === "core" ? -1 : 1))) {
    lines.push("");
    lines.push(...slot(s));
  }
  lines.push("");
  lines.push(`## Policies (${pol.version ?? "no version"})`);
  lines.push("");
  lines.push("| Request | Decision | How |");
  lines.push("|---|---|---|");
  for (const r of pol.requests ?? []) lines.push(`| ${r.kind ?? "—"} | ${r.decision ?? "—"} | ${esc(r.how ?? "")} |`);
  lines.push("");
  lines.push(`- **Off topic:** ${pol.off_topic ?? "—"}`);
  lines.push(`- **Time management:** ${pol.time_management ?? "—"}`);
  lines.push(`- **Integrity:** ${pol.integrity ?? "—"}`);
  lines.push(`- **Fallback:** ${pol.fallback ?? "—"}`);
  lines.push("");
  lines.push("## Global evaluation signals");
  lines.push("");
  lines.push(bullets((bp.evaluation.global_signals ?? []).map((g) => `${g.signal ?? "—"}: ${g.observe ?? "—"}`)));
  if (bp.evaluation.note) {
    lines.push("");
    lines.push(`_${bp.evaluation.note}_`);
  }
  lines.push("");
  return lines.join("\n");
}
