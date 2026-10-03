import { z } from "zod";
import { ApiError } from "../lib/errors.js";
import { ROUND_TYPES } from "./enums.js";

const text = (max: number) => z.string().trim().max(max);
const uuid = z.uuid().transform((value) => value.toLowerCase());
const urls = z.array(text(2048).refine((value) => {
  try {
    const u = new URL(value);
    return /^https?:\/\//i.test(value) && ["https:", "http:"].includes(u.protocol) && !!u.hostname && !u.username && !u.password && !/[\s\u0000-\u001f\u007f]/.test(value);
  } catch { return false; }
}, "must be an absolute http(s) URL without credentials")).max(20);
const round = z.object({
  id: uuid, name: text(255), type: z.enum(ROUND_TYPES),
  /** `info` rounds (online tests, take-homes…) are display-only: never scheduled, scored or counted. */
  kind: z.enum(["interview", "info"]).optional(),
  durationMinutes: z.number().int().min(1).max(240), difficulty: z.enum(["easy", "medium", "hard"]),
  topics: z.array(text(255)).max(30), questions: z.array(text(2000)).max(30),
  guidance: text(10000), sourceUrls: urls, verified: z.boolean(),
}).strict();
const role = z.object({
  id: uuid, jdId: uuid.nullable().optional(), title: text(255), role: text(255), level: text(16),
  specialization: text(32).nullable(), description: text(20000), techStack: z.array(text(255)).max(50),
  yoeMin: z.number().min(0).max(99.9).nullable(), yoeMax: z.number().min(0).max(99.9).nullable(),
  ctcMinLpa: z.number().min(0).max(9999.99).nullable(), ctcMaxLpa: z.number().min(0).max(9999.99).nullable(),
  sourceUrls: urls, verified: z.boolean(), rounds: z.array(round).max(12),
}).strict();
const document = z.object({
  company: z.object({ overview: text(10000), culture: text(10000), benefits: text(10000), sourceUrls: urls, verified: z.boolean() }).strict(),
  roles: z.array(role).max(50),
}).strict();
const request = z.object({ revision: z.number().int().min(0).max(2147483646), document }).strict();
export type EnrichmentDocument = z.infer<typeof document>;
export type EnrichmentRole = z.infer<typeof role>;

export function parseEnrichment(input: unknown, publish: boolean): z.infer<typeof request> {
  const parsed = request.safeParse(input);
  const invalid = (message: string): never => { throw new ApiError(400, "invalid_enrichment", message); };
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    return invalid(`${issue.path.join(".")}: ${issue.message}`);
  }
  const d = parsed.data.document;
  const ids = new Set<string>();
  const jds = new Set<string>();
  const unique = (id: string) => { if (ids.has(id.toLowerCase())) invalid("Role and round IDs must be unique"); ids.add(id.toLowerCase()); };
  if (publish && (!d.company.verified || !d.company.overview || !d.company.sourceUrls.length || !d.roles.length)) {
    invalid("Publication requires a verified company overview with evidence and at least one role");
  }
  for (const r of d.roles) {
    unique(r.id);
    if (r.jdId) { if (jds.has(r.jdId.toLowerCase())) invalid("Each JD may appear only once"); jds.add(r.jdId.toLowerCase()); }
    if (r.yoeMin !== null && r.yoeMax !== null && r.yoeMin > r.yoeMax) invalid("Minimum experience must not exceed maximum experience");
    if (r.ctcMinLpa !== null && r.ctcMaxLpa !== null && r.ctcMinLpa > r.ctcMaxLpa) invalid("Minimum compensation must not exceed maximum compensation");
    if (publish && (!r.verified || !r.title || !r.role || !r.level || !r.description || !r.sourceUrls.length || !r.rounds.length)) {
      invalid("Each published role requires title, role, level, description, evidence, verification and at least one round");
    }
    for (const item of r.rounds) {
      unique(item.id);
      if (publish && (!item.verified || !item.name || !item.sourceUrls.length)) invalid("Each round requires a name, evidence and verification");
    }
  }
  return parsed.data;
}

/** Shape consumed by both catalogue and Python prep's round-scoped grounding. */
export function enrichmentBrief(company: string, role: EnrichmentRole, facts: EnrichmentDocument["company"], revision: number, at: Date) {
  return {
    company, role: role.role, level: role.level, specialization: role.specialization,
    generated_at: at.toISOString(), generation_status: "completed", data_confidence: "high",
    provenance: "admin_verified", published_revision: revision,
    sources: [...new Set([...facts.sourceUrls, ...role.sourceUrls, ...role.rounds.flatMap((r) => r.sourceUrls)])],
    company_overview: facts,
    final_experience: {
      rounds: role.rounds.map((r, i) => ({
        id: r.id, round_number: i + 1, name: r.name, type: r.type, kind: r.kind ?? "interview", duration_minutes: r.durationMinutes,
        difficulty: r.difficulty, topics: r.topics, problems: r.questions, format: r.guidance,
        provenance: "admin_verified", source_urls: r.sourceUrls,
      })),
      dominant_topics: [...new Set(role.rounds.flatMap((r) => r.topics))],
      company_specific_patterns: [facts.overview, facts.culture, facts.benefits].filter(Boolean).join("\n\n"),
      data_confidence: "high", template_used: false,
    },
  };
}
export type EnrichmentBrief = ReturnType<typeof enrichmentBrief>;
