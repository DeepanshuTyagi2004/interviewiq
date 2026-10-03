/**
 * Loads the hand-curated multi-company catalogue (apps/api/scripts/catalogue/*) into Postgres.
 *
 * For each company it upserts the `companies` row (all profile fields), then publishes an enrichment
 * document through CompanyEnrichmentService, which in one transaction writes `job_descriptions`,
 * `manual_jd_briefs` (the rounds the interviewer uses) and `company_role_configs` — the same path an
 * admin-approved company takes. Re-running updates in place (role/round ids are deterministic).
 *
 * Usage (from apps/api, with DATABASE_URL in .env or the environment):
 *   pnpm tsx --env-file=.env scripts/seed-catalogue.ts            # dry run: validate + print summary
 *   pnpm tsx --env-file=.env scripts/seed-catalogue.ts --apply    # write to the database
 *   add --only=google,razorpay to limit companies
 */
import { eq } from "drizzle-orm";
import { companies, companyEnrichments } from "../src/db/pg/schema.js";
import { createDatabase, createPgPool, type SslMode } from "../src/db/pg/client.js";
import { parseEnrichment, type EnrichmentDocument } from "../src/domain/enrichment.js";
import { CompanyEnrichmentService } from "../src/services/companyEnrichment.js";
import { TIER1 } from "./catalogue/tier1.js";
import { TIER2 } from "./catalogue/tier2.js";
import { TIER3 } from "./catalogue/tier3.js";
import { TIER4 } from "./catalogue/tier4.js";
import { rid, type CompanyIn } from "./catalogue/types.js";

const ROLE = "software-engineer";
const SEED_ACTOR = "00000000-0000-4000-8000-000000000001";
const apply = process.argv.includes("--apply");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");

/**
 * Rounds that are not interviews an AI interviewer can run: online tests, aptitude and
 * communication assessments, take-homes and practical tasks. They are stored as `info` rounds.
 */
const INFO_ROUND = /(online (assessment|aptitude|coding)|assessment|aptitude|take-home|assignment|nqt|practical task|cognitive)/i;

const uniq = (urls: string[]) => [...new Set(urls)].slice(0, 20);

function toDocument(c: CompanyIn): EnrichmentDocument {
  return {
    company: { overview: c.overview, culture: c.culture, benefits: c.benefits, sourceUrls: uniq(c.src), verified: true },
    roles: c.roles.map((r) => ({
      id: rid(c.slug, r.key),
      jdId: null,
      title: r.title, role: ROLE, level: r.level, specialization: r.spec,
      description: r.description, techStack: r.stack,
      yoeMin: r.yoe[0], yoeMax: r.yoe[1],
      ctcMinLpa: r.ctc ? r.ctc[0] : null, ctcMaxLpa: r.ctc ? r.ctc[1] : null,
      sourceUrls: uniq(r.src), verified: true,
      rounds: r.rounds.map((x, i) => ({
        id: rid(c.slug, `${r.key}|round|${i}`),
        name: x.name, type: x.type, kind: INFO_ROUND.test(x.name) ? ("info" as const) : ("interview" as const), durationMinutes: x.minutes, difficulty: x.difficulty,
        topics: x.topics, questions: x.questions ?? [], guidance: x.guidance,
        sourceUrls: uniq(x.src), verified: true,
      })),
    })),
  };
}

/** companies columns with a hard varchar limit — fail in the dry run, not halfway through a write. */
function checkColumns(c: CompanyIn): string[] {
  const limits: [string, string, number][] = [
    ["name", c.name, 255], ["slug", c.slug, 255], ["hq", c.hq, 255], ["size", c.size, 255], ["website", c.website, 255],
    ["sector", c.sector, 64], ["businessModel", c.businessModel, 16], ["headcountBand", c.headcountBand, 32],
    ["revenueBand", c.revenueBand, 32], ["fundingStage", c.fundingStage, 32],
  ];
  return limits.filter(([, v, max]) => v.length > max).map(([k, v, max]) => `${c.slug}.${k} is ${v.length} chars (max ${max}): ${v}`);
}

const all: CompanyIn[] = [...TIER1, ...TIER2, ...TIER3, ...TIER4].filter((c) => !only || only.includes(c.slug));

let problems: string[] = [];
let roleCount = 0;
let roundCount = 0;
for (const c of all) {
  problems.push(...checkColumns(c));
  if (c.wlbRating !== null && (c.wlbRating < 0 || c.wlbRating > 5)) problems.push(`${c.slug}.wlbRating out of range`);
  try {
    parseEnrichment({ revision: 0, document: toDocument(c) }, true);
  } catch (err) {
    problems.push(`${c.slug}: ${(err as Error).message}`);
  }
  roleCount += c.roles.length;
  roundCount += c.roles.reduce((n, r) => n + r.rounds.length, 0);
  console.log(`T${c.tier}  ${c.name.padEnd(14)} ${String(c.roles.length).padStart(2)} roles  ${c.roles.reduce((n, r) => n + r.rounds.length, 0)} rounds`);
}
console.log(`\n${all.length} companies, ${roleCount} roles, ${roundCount} rounds`);
if (problems.length) {
  console.error("\nValidation problems:\n- " + problems.join("\n- "));
  process.exit(1);
}
if (!apply) {
  console.log("Dry run OK. Re-run with --apply to write to the database.");
  process.exit(0);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required with --apply");
  process.exit(1);
}
const pool = createPgPool({
  url: databaseUrl,
  ssl: (process.env.DATABASE_SSL as SslMode | undefined) ?? "auto",
  sslCaFile: process.env.DATABASE_SSL_CA || undefined,
  poolMax: Number(process.env.DATABASE_POOL_MAX ?? 8),
});
const db = createDatabase(pool);
const service = new CompanyEnrichmentService(db);

try {
  for (const c of all) {
    const profile = {
      name: c.name, tier: c.tier, tierRationale: c.tierRationale, headquarterLocation: c.hq, companySize: c.size,
      website: c.website, aliases: c.aliases, sector: c.sector, businessModel: c.businessModel,
      headcountBand: c.headcountBand, revenueBand: c.revenueBand, fundingStage: c.fundingStage,
      wlbRating: c.wlbRating === null ? null : c.wlbRating.toFixed(1), wlbReviewCount: c.wlbReviewCount,
      reviewSummary: c.reviewSummary, reviewQuotes: c.reviewQuotes, status: "active" as const,
    };
    const [existing] = await db.select().from(companies).where(eq(companies.slug, c.slug));
    let companyId: string;
    if (existing) {
      await db.update(companies).set(profile).where(eq(companies.id, existing.id));
      companyId = existing.id;
    } else {
      const [row] = await db.insert(companies).values({ ...profile, slug: c.slug, origin: "seed" }).returning();
      companyId = row!.id;
    }
    const [enrich] = await db.select().from(companyEnrichments).where(eq(companyEnrichments.companyId, companyId));
    await service.write(companyId, { revision: enrich?.revision ?? 0, document: toDocument(c) }, SEED_ACTOR, true);
    console.log(`wrote ${c.slug}`);
  }
} finally {
  await pool.end();
}
