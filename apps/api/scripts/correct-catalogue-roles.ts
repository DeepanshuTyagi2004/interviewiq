/**
 * Corrects role labels in already-published catalogue data without replacing role IDs or rounds.
 *
 * Dry run (default): pnpm tsx --env-file=.env scripts/correct-catalogue-roles.ts
 * Apply:           pnpm tsx --env-file=.env scripts/correct-catalogue-roles.ts --apply
 *
 * The source catalogue is corrected alongside this script. This script is for databases that were
 * already ingested through the manual-enrichment path, whose role IDs are not the seed IDs.
 */
import { and, eq } from "drizzle-orm";
import { createDatabase, createPgPool, type SslMode } from "../src/db/pg/client.js";
import {
  companies,
  companyEnrichments,
  companyRoleConfigs,
  interviewSessions,
  jobDescriptions,
  manualJdBriefs,
} from "../src/db/pg/schema.js";
import type { EnrichmentDocument } from "../src/domain/enrichment.js";

type Correction = {
  company: string;
  fromTitle: string;
  toTitle: string;
  level: string;
  specialization: string;
};

/** These are naming corrections only; company-native tracks and evidence remain unchanged. */
const CORRECTIONS: Correction[] = [
  {
    company: "google",
    fromTitle: "Software Engineer III (L3)",
    toTitle: "Software Engineer (L3)",
    level: "fresher",
    specialization: "backend",
  },
  {
    company: "google",
    fromTitle: "Software Engineer III / Senior SWE (L4)",
    toTitle: "Software Engineer II (L4)",
    level: "sde2",
    specialization: "backend",
  },
  {
    company: "zerodha",
    fromTitle: "Software Development Engineer 2",
    toTitle: "Software Development Engineer II (SDE-2)",
    level: "sde2",
    specialization: "backend",
  },
];

const apply = process.argv.includes("--apply");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const pool = createPgPool({
  url: databaseUrl,
  ssl: (process.env.DATABASE_SSL as SslMode | undefined) ?? "auto",
  sslCaFile: process.env.DATABASE_SSL_CA || undefined,
  poolMax: 2,
});
const db = createDatabase(pool);

function updateDocument(document: EnrichmentDocument | null, jdId: string, correction: Correction): EnrichmentDocument | null {
  if (!document) return document;
  let matched = false;
  const roles = document.roles.map((role) => {
    if (role.jdId !== jdId) return role;
    matched = true;
    return { ...role, title: correction.toTitle, level: correction.level };
  });
  if (!matched) throw new Error(`enrichment role for JD ${jdId} was not found`);
  return { ...document, roles };
}

try {
  const allChanges: Array<{ company: string; jdId: string; from: string; to: string; level: string }> = [];

  for (const correction of CORRECTIONS) {
    const rows = await db
      .select()
      .from(jobDescriptions)
      .where(and(
        eq(jobDescriptions.company, correction.company),
        eq(jobDescriptions.title, correction.fromTitle),
        eq(jobDescriptions.level, correction.level),
        eq(jobDescriptions.specialization, correction.specialization),
        eq(jobDescriptions.active, true),
      ));
    if (rows.length === 0) {
      const alreadyCorrected = await db
        .select()
        .from(jobDescriptions)
        .where(and(
          eq(jobDescriptions.company, correction.company),
          eq(jobDescriptions.title, correction.toTitle),
          eq(jobDescriptions.level, correction.level),
          eq(jobDescriptions.specialization, correction.specialization),
          eq(jobDescriptions.active, true),
        ));
      if (alreadyCorrected.length === 1) {
        console.log(`${correction.company}: ${correction.toTitle} already corrected`);
        continue;
      }
    }
    if (rows.length !== 1) {
      throw new Error(`${correction.company}: expected one active ${correction.fromTitle}, found ${rows.length}`);
    }
    const jd = rows[0]!;
    allChanges.push({ company: correction.company, jdId: jd.id, from: jd.title, to: correction.toTitle, level: jd.level });
  }

  for (const change of allChanges) {
    console.log(`${change.company}: ${change.from} → ${change.to} [${change.level}] (${change.jdId})`);
  }
  if (!apply) {
    console.log(`\nDry run only: ${allChanges.length} role labels would be corrected. Re-run with --apply to write.`);
    process.exitCode = 0;
  } else {
    await db.transaction(async (tx) => {
      const now = new Date();
      const byCompany = new Map<string, typeof allChanges>();
      for (const change of allChanges) byCompany.set(change.company, [...(byCompany.get(change.company) ?? []), change]);

      for (const [companySlug, changes] of byCompany) {
        const [company] = await tx.select().from(companies).where(eq(companies.slug, companySlug)).for("update");
        if (!company) throw new Error(`${companySlug}: company row not found`);
        const [enrichment] = await tx.select().from(companyEnrichments).where(eq(companyEnrichments.companyId, company.id)).for("update");
        if (!enrichment) throw new Error(`${companySlug}: enrichment row not found`);

        let document = enrichment.document;
        let publishedDocument = enrichment.publishedDocument;
        for (const change of changes) {
          const correction = CORRECTIONS.find((item) => item.company === companySlug && item.fromTitle === change.from && item.level === change.level);
          if (!correction) throw new Error(`${companySlug}: correction map mismatch for ${change.from}`);
          const sessions = await tx.select({ id: interviewSessions.id }).from(interviewSessions).where(eq(interviewSessions.jobDescriptionId, change.jdId));
          // Current corrections do not change levels, but keep this guard if the map is extended.
          if (correction.level !== change.level && sessions.length) {
            throw new Error(`${companySlug}: cannot change level for booked JD ${change.jdId}`);
          }
          document = updateDocument(document, change.jdId, correction)!;
          publishedDocument = updateDocument(publishedDocument, change.jdId, correction);

          await tx.update(jobDescriptions).set({ title: correction.toTitle }).where(eq(jobDescriptions.id, change.jdId));
          await tx.update(companyRoleConfigs).set({ title: correction.toTitle }).where(and(
            eq(companyRoleConfigs.company, companySlug),
            eq(companyRoleConfigs.role, "software-engineer"),
            eq(companyRoleConfigs.level, correction.level),
          ));
          const [manualBrief] = await tx.select().from(manualJdBriefs).where(eq(manualJdBriefs.jdId, change.jdId));
          if (!manualBrief) throw new Error(`${companySlug}: manual brief for JD ${change.jdId} not found`);
          await tx.update(manualJdBriefs).set({ brief: { ...manualBrief.brief, level: correction.level } }).where(eq(manualJdBriefs.jdId, change.jdId));
        }

        const nextRevision = enrichment.revision + 1;
        await tx.update(companyEnrichments).set({
          revision: nextRevision,
          document,
          ...(publishedDocument ? { publishedDocument, publishedRevision: nextRevision, publishedAt: now } : {}),
        }).where(and(eq(companyEnrichments.companyId, company.id), eq(companyEnrichments.revision, enrichment.revision)));
        if (publishedDocument) {
          await tx.update(companies).set({ publishedVersion: (company.publishedVersion ?? 0) + 1, publishedAt: now }).where(eq(companies.id, company.id));
        }
      }
    });
    console.log(`\nApplied ${allChanges.length} role-label corrections.`);
  }
} finally {
  await pool.end();
}
