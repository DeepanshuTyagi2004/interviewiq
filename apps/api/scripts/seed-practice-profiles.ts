/**
 * Insert generic practice templates for the current DB company inventory; preserve existing data.
 * Template JDs carry the level's typical experience range (`LEVEL_EXPERIENCE_YEARS`, shown as
 * "typical for level", never a company requirement); --apply also fills it on older templates that
 * have none. Pay and every other hiring fact stay empty.
 * From apps/api (DATABASE_URL required for inventory even in dry run):
 *   pnpm exec tsx --env-file=.env scripts/seed-practice-profiles.ts
 *   pnpm exec tsx --env-file=.env scripts/seed-practice-profiles.ts --apply
 * Optional: --only=google,razorpay. Imports have no CLI side effects.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { createDatabase, createPgPool, type Database, type SslMode } from "../src/db/pg/client.js";
import { companies, companyRoleConfigs, jobDescriptions, manualJdBriefs } from "../src/db/pg/schema.js";
import { parseEnrichment, type EnrichmentRole } from "../src/domain/enrichment.js";
import { LEVEL_EXPERIENCE_YEARS, type EngineeringLevel } from "../src/domain/engineeringLevels.js";
import {
  PRACTICE_LEVELS, PRACTICE_LEVEL_LABELS, PRACTICE_NOTICE, PRACTICE_ROLE,
   practiceBrief, practiceOverview, practiceProfiles, practiceRoleKey, type PracticeLevel, type PracticeProfile, type PracticeRole,
} from "./catalogue/practiceProfiles.js";

export interface PracticeSeedOptions { apply?: boolean; only?: readonly string[]; at?: Date }
export interface PracticeCompanyReport {
  company: string; status: string; skipped: boolean; profiles: number; rounds: number;
  missingJds: number; missingBriefs: number; missingConfigs: number; missingExperience: number;
  insertedJds: number; insertedBriefs: number; insertedConfigs: number; filledExperience: number;
}
export interface PracticeSeedReport { applied: boolean; companies: PracticeCompanyReport[]; validation: "passed" }
type SeedDb = Pick<Database, "select" | "insert" | "update">;
/** The level's typical range as the numeric columns store it. */
function typicalYears(level: string): { yoeMin: string; yoeMax: string | null } {
  const [min, max] = LEVEL_EXPERIENCE_YEARS[level as EngineeringLevel] ?? LEVEL_EXPERIENCE_YEARS.fresher;
  return { yoeMin: String(min), yoeMax: max === null ? null : String(max) };
}

/** Only our own validation messages are safe to print; driver errors can embed query data. */
class PracticeSeedError extends Error {}

function validate(slug: string, roles: EnrichmentRole[]): void {
  // Validation only; templates are never persisted in company_enrichments or published documents.
  parseEnrichment({ revision: 0, document: { company: practiceOverview(), roles } }, false);
  if (roles.length !== 48 || new Set(roles.map((role) => role.id)).size !== 48) throw new PracticeSeedError(`${slug}: invalid practice matrix`);
  for (const role of roles) {
    if (role.verified || role.sourceUrls.length || role.yoeMin !== null || role.yoeMax !== null || role.ctcMinLpa !== null || role.ctcMaxLpa !== null || !role.description.includes(PRACTICE_NOTICE)) {
      throw new PracticeSeedError(`${slug}: practice profile contains unsupported factual claims`);
    }
  }
}

async function inventory(db: SeedDb, company: { id: string; slug: string; status: string }, roles: PracticeRole[]) {
  const existingJds = await db.select().from(jobDescriptions).where(eq(jobDescriptions.company, company.slug));
  const existingBriefs = await db.select().from(manualJdBriefs).where(eq(manualJdBriefs.companyId, company.id));
  const existingConfigs = await db.select().from(companyRoleConfigs).where(eq(companyRoleConfigs.company, company.slug));
  for (const role of roles) {
    const key = practiceRoleKey(role.level as PracticeLevel, role.specialization as PracticeProfile);
    const sameId = existingJds.find((jd) => jd.id === role.id);
    const sameKey = existingJds.find((jd) => jd.roleKey === key);
    if ((sameId && (sameId.source !== "template" || sameId.role !== role.role || sameId.level !== role.level || sameId.specialization !== role.specialization || sameId.roleKey !== key)) || (sameKey && sameKey.id !== role.id)) {
      throw new PracticeSeedError(`${company.slug}: practice identity collides with an existing JD (${key})`);
    }
    const brief = existingBriefs.find((item) => item.roleId === role.id || item.jdId === role.id);
    if (brief && (brief.jdId !== role.id || brief.roleId !== role.id)) throw new PracticeSeedError(`${company.slug}: practice identity collides with an existing brief (${key})`);
  }
  const missingRoles = roles.filter((role) => !existingJds.some((jd) => jd.id === role.id));
  const missingBriefRoles = roles.filter((role) => !existingBriefs.some((brief) => brief.jdId === role.id));
  const missingLevels = PRACTICE_LEVELS.filter((level) => !existingConfigs.some((config) => config.role === PRACTICE_ROLE && config.level === level));
  const missingExperience = existingJds.filter((jd) => jd.source === "template" && jd.yoeMin === null && jd.yoeMax === null);
  return { missingRoles, missingBriefRoles, missingLevels, missingExperience };
}

/** Default is read-only. Applying locks and rechecks every company inside ONE transaction. */
export async function seedPracticeProfiles(db: Database, options: PracticeSeedOptions = {}): Promise<PracticeSeedReport> {
  const at = options.at ?? new Date();
  if (!Number.isFinite(at.getTime())) throw new PracticeSeedError("A valid generation timestamp is required");
  const selected = await db.select({ id: companies.id, slug: companies.slug, status: companies.status }).from(companies)
    .where(options.only ? inArray(companies.slug, [...options.only]) : undefined).orderBy(asc(companies.slug));
  const found = new Set(selected.map((company) => company.slug));
  if (options.only?.some((slug) => !found.has(slug))) throw new PracticeSeedError("--only contains a company not present in the database inventory");
  // Validate all selected active matrices before the first write.
  const matrices = new Map(selected.filter((company) => company.status === "active").map((company) => {
    const roles = practiceProfiles(company.slug);
    validate(company.slug, roles);
    return [company.slug, roles] as const;
  }));
  const run = async (executor: SeedDb, apply: boolean): Promise<PracticeSeedReport> => {
    const reports: PracticeCompanyReport[] = [];
    for (const before of selected) {
      // The lock is also used by approval/archive flows. A company archived since inventory is skipped.
      const [locked] = apply ? await executor.select({ id: companies.id, slug: companies.slug, status: companies.status })
        .from(companies).where(eq(companies.id, before.id)).for("update") : [before];
      const report: PracticeCompanyReport = {
        company: before.slug, status: locked?.status ?? "missing", skipped: !locked || locked.status !== "active",
        profiles: 0, rounds: 0, missingJds: 0, missingBriefs: 0, missingConfigs: 0, missingExperience: 0,
        insertedJds: 0, insertedBriefs: 0, insertedConfigs: 0, filledExperience: 0,
      };
      reports.push(report);
      if (report.skipped || !locked) continue;
      if (locked.slug !== before.slug) throw new PracticeSeedError(`${before.slug}: company identity changed during inventory`);
      const roles = matrices.get(locked.slug) ?? practiceProfiles(locked.slug);
      validate(locked.slug, roles);
      const { missingRoles, missingBriefRoles, missingLevels, missingExperience } = await inventory(executor, locked, roles);
      report.profiles = roles.length;
      report.rounds = roles.reduce((total, role) => total + role.rounds.length, 0);
      report.missingJds = missingRoles.length;
      report.missingBriefs = missingBriefRoles.length;
      report.missingConfigs = missingLevels.length;
      report.missingExperience = missingExperience.length;
      if (!apply) continue;
      // Older templates: fill only an empty range, never overwrite one.
      for (const level of new Set(missingExperience.map((jd) => jd.level))) {
        const filled = await executor.update(jobDescriptions).set(typicalYears(level))
          .where(and(eq(jobDescriptions.company, locked.slug), eq(jobDescriptions.source, "template"), eq(jobDescriptions.level, level), isNull(jobDescriptions.yoeMin), isNull(jobDescriptions.yoeMax)))
          .returning({ id: jobDescriptions.id });
        report.filledExperience += filled.length;
      }
      if (missingRoles.length) {
        const inserted = await executor.insert(jobDescriptions).values(missingRoles.map((role) => ({
          id: role.id, company: locked.slug, role: role.role, level: role.level, title: role.title,
          specialization: role.specialization, description: role.description, techStack: role.techStack.join(", "),
          sourceUrl: null, source: "template", active: true,
          ...typicalYears(role.level ?? "fresher"), ctcMinLpa: null, ctcMaxLpa: null, ctcSourceCount: null,
          roleKey: practiceRoleKey(role.level as PracticeLevel, role.specialization as PracticeProfile),
        }))).onConflictDoNothing().returning({ id: jobDescriptions.id });
        // A conflicting concurrent writer must not cause a brief to attach to a different JD.
        if (inserted.length !== missingRoles.length) throw new PracticeSeedError(`${locked.slug}: concurrent JD identity conflict; no practice data was applied`);
        report.insertedJds = inserted.length;
      }
      if (missingBriefRoles.length) {
        const inserted = await executor.insert(manualJdBriefs).values(missingBriefRoles.map((role) => ({
          jdId: role.id, companyId: locked.id, roleId: role.id,
          brief: practiceBrief(locked.slug, role, at),
        }))).onConflictDoNothing().returning({ jdId: manualJdBriefs.jdId });
        if (inserted.length !== missingBriefRoles.length) throw new PracticeSeedError(`${locked.slug}: concurrent brief identity conflict; no practice data was applied`);
        report.insertedBriefs = inserted.length;
      }
      if (missingLevels.length) {
        const inserted = await executor.insert(companyRoleConfigs).values(missingLevels.map((level) => ({
          company: locked.slug, role: PRACTICE_ROLE, level,
          title: `Software Engineer · ${PRACTICE_LEVEL_LABELS[level]} [Practice template]`,
          jdUrl: null, jdDescription: PRACTICE_NOTICE,
          requirements: "Generic practice scope only; no company hiring requirements are asserted.",
          responsibilities: "Simulated exercises only; no company job responsibilities are asserted.",
          techStack: null, roundCount: null, enabled: true,
        }))).onConflictDoNothing({ target: [companyRoleConfigs.company, companyRoleConfigs.role, companyRoleConfigs.level] })
          .returning({ id: companyRoleConfigs.id });
        report.insertedConfigs = inserted.length;
      }
    }
    return { applied: apply, companies: reports, validation: "passed" };
  };
  return options.apply ? db.transaction((tx) => run(tx, true)) : run(db, false);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--apply" && !arg.startsWith("--only="))) throw new PracticeSeedError("Usage: seed-practice-profiles.ts [--apply] [--only=slug,slug]");
  const onlyArg = args.find((arg) => arg.startsWith("--only="));
  const only = onlyArg?.slice(7).split(",").map((slug) => slug.trim()).filter(Boolean);
  if (onlyArg && !only?.length) throw new PracticeSeedError("--only requires at least one company slug");
  const url = process.env.DATABASE_URL;
  if (!url) throw new PracticeSeedError("DATABASE_URL is required to read the current company inventory");
  const pool = createPgPool({
    url, ssl: (process.env.DATABASE_SSL as SslMode | undefined) ?? "auto",
    sslCaFile: process.env.DATABASE_SSL_CA || undefined, poolMax: 2,
  });
  try {
    const report = await seedPracticeProfiles(createDatabase(pool), { apply: args.includes("--apply"), only });
    console.log(JSON.stringify(report, null, 2));
    console.log(report.applied ? "Practice templates applied. Existing catalogue data preserved." : "Dry run passed; no writes. Re-run with --apply to insert practice templates.");
  } finally { await pool.end(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    // Do not print driver errors (they can include query parameters or connection details).
    console.error(error instanceof PracticeSeedError ? error.message : "Practice seed failed; no transaction changes were committed.");
    process.exitCode = 1;
  });
}
