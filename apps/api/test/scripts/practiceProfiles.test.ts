import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { seedPracticeProfiles } from "../../scripts/seed-practice-profiles.js";
import {
  PRACTICE_LEVELS, PRACTICE_NOTICE, PRACTICE_PROFILES, practiceBrief, practiceOverview, practiceProfiles,
} from "../../scripts/catalogue/practiceProfiles.js";
import { rid } from "../../scripts/catalogue/types.js";
import { companies, companyEnrichments, companyRoleConfigs, jobDescriptions, manualJdBriefs } from "../../src/db/pg/schema.js";
import { enrichmentBrief, parseEnrichment, type EnrichmentBrief, type EnrichmentRole } from "../../src/domain/enrichment.js";
import { ROUND_TYPES } from "../../src/domain/enums.js";
import { LEVEL_EXPERIENCE_YEARS, parseEngineeringLevel, type EngineeringLevel } from "../../src/domain/engineeringLevels.js";
import { createTestDb } from "../support/harness.js";

const AT = new Date("2026-10-03T00:00:00.000Z");
const closers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(closers.splice(0).map((close) => close())); });
async function database() {
  const pg = await createTestDb();
  closers.push(pg.close);
  return pg.db;
}

describe("practice profile matrix", () => {
  it("covers all eight levels and six specializations with deterministic, explicitly unsourced simulations", () => {
    expect(PRACTICE_LEVELS).toEqual(["intern", "fresher", "sde1", "sde2", "sde3", "staff", "principal", "distinguished"]);
    expect(PRACTICE_PROFILES).toEqual(["backend", "frontend", "fullstack", "data-science", "ai-ml", "devops"]);
    const roles = practiceProfiles("existing-company");
    expect(roles).toHaveLength(48);
    expect(practiceProfiles("existing-company")).toEqual(roles);
    expect(new Set(roles.map((role) => role.id)).size).toBe(48);
    expect(practiceProfiles("another-company").map((role) => role.id)).not.toEqual(roles.map((role) => role.id));
    for (const level of PRACTICE_LEVELS) {
      expect(roles.filter((role) => role.level === level).map((role) => role.specialization)).toEqual([...PRACTICE_PROFILES]);
    }
    for (const role of roles) {
      expect(role.id).toBe(rid("existing-company", `practice|${role.level}|${role.specialization}`));
      expect(role.jdId).toBe(role.id);
      expect(role.title).toContain("[Practice template]");
      expect(role.description).toContain(PRACTICE_NOTICE);
      expect(role.role).toBe("software-engineer");
      expect(role).toMatchObject({ verified: false, sourceUrls: [], yoeMin: null, yoeMax: null, ctcMinLpa: null, ctcMaxLpa: null });
      for (const round of role.rounds) {
        expect(ROUND_TYPES).toContain(round.type);
        expect(round).toMatchObject({ kind: "interview", verified: false, sourceUrls: [], questions: [] });
        expect(round.topics.length).toBeGreaterThan(0);
        expect(round.durationMinutes).toBeGreaterThan(0);
        expect(["easy", "medium", "hard"]).toContain(round.difficulty);
        expect(round.guidance).toContain(PRACTICE_NOTICE);
        expect(round.name).toContain("[Practice template]");
      }
      // Compile-time structural compatibility, including no human publication revision.
      const brief: EnrichmentBrief = practiceBrief("existing-company", role, AT);
      expect(brief).toMatchObject({ provenance: "practice_template", data_confidence: "low", published_revision: null, sources: [] });
      expect(brief.company_overview).toEqual(practiceOverview());
      expect(brief.final_experience).toMatchObject({ template_used: true, data_confidence: "low" });
      expect(brief.final_experience.rounds.map((round) => round.provenance)).toEqual(role.rounds.map(() => "practice_template"));
      expect(brief.final_experience.rounds.every((round) => round.source_urls.length === 0)).toBe(true);
      expect(JSON.stringify(brief)).not.toContain("admin_verified");
      expect(JSON.stringify(brief)).not.toContain("https://");
    }
    expect(() => parseEnrichment({ revision: 0, document: { company: practiceOverview(), roles } }, false)).not.toThrow();
    expect(() => parseEnrichment({ revision: 0, document: { company: practiceOverview(), roles } }, true)).toThrow("verified");
  });
});

describe("practice profile seed persistence", () => {
  it("defaults to read-only DB inventory and skips archived companies", async () => {
    const db = await database();
    await db.insert(companies).values([
      { name: "Active", slug: "active", status: "active" },
      { name: "Archived", slug: "archived", status: "archived" },
    ]);
    const before = await db.select().from(companies);
    const report = await seedPracticeProfiles(db, { at: AT });
    expect(report.applied).toBe(false);
    expect(report.validation).toBe("passed");
    expect(report.companies[0]).toMatchObject({ company: "active", profiles: 48, missingJds: 48, missingBriefs: 48, missingConfigs: 8, insertedJds: 0 });
    expect(report.companies[1]).toMatchObject({ company: "archived", skipped: true, profiles: 0 });
    expect(await db.select().from(companies)).toEqual(before);
    expect(await db.select().from(jobDescriptions)).toEqual([]);
    expect(await db.select().from(manualJdBriefs)).toEqual([]);
    expect(await db.select().from(companyRoleConfigs)).toEqual([]);
    expect(await db.select().from(companyEnrichments)).toEqual([]);
  });

  it("persists idempotent templates while preserving 43 existing JDs, manual briefs, publication, and disabled config", async () => {
    const db = await database();
    const [company] = await db.insert(companies).values({ name: "Inventory company", slug: "inventory", status: "active", publishedVersion: 7, publishedAt: AT }).returning();
    await db.insert(companies).values({ name: "Archived", slug: "archived", status: "archived" });
    const facts = { overview: "Existing stored evidence fixture", culture: "Existing culture fixture", benefits: "Existing benefits fixture", sourceUrls: ["https://evidence.example/overview"], verified: true };
    const storedRoles: EnrichmentRole[] = Array.from({ length: 43 }, (_, index) => {
      const id = randomUUID();
      return {
        ...practiceProfiles("inventory")[0]!, id, jdId: id, title: `Existing stored role ${index}`,
        description: "Existing role fixture", level: "sde2", specialization: "backend", verified: true,
        yoeMin: 2, yoeMax: 5, ctcMinLpa: 10, ctcMaxLpa: 20, sourceUrls: ["https://evidence.example/role"],
        rounds: [{ ...practiceProfiles("inventory")[0]!.rounds[0]!, id: randomUUID(), name: "Existing coding fixture", sourceUrls: ["https://evidence.example/process"], verified: true }],
      };
    });
    await db.insert(jobDescriptions).values(storedRoles.map((role, index) => ({
      id: role.id, company: "inventory", role: role.role, level: parseEngineeringLevel(role.level), title: role.title,
      specialization: role.specialization, description: role.description, source: "manual", active: index !== 0,
      sourceUrl: "https://evidence.example/role", roleKey: `existing-${index}`,
      yoeMin: "2", yoeMax: "5", ctcMinLpa: "10", ctcMaxLpa: "20", ctcSourceCount: 1,
    })));
    await db.insert(manualJdBriefs).values(storedRoles.map((role) => ({
      jdId: role.id, roleId: role.id, companyId: company!.id, brief: enrichmentBrief("inventory", role, facts, 7, AT),
    })));
    await db.insert(companyRoleConfigs).values({
      company: "inventory", role: "software-engineer", level: "sde2", title: "Existing configured title",
      jdDescription: "Keep this private configuration", roundCount: 9, enabled: false,
    });
    await db.insert(companyEnrichments).values({
      companyId: company!.id, revision: 7, publishedRevision: 7, publishedAt: AT,
      document: { company: facts, roles: storedRoles }, publishedDocument: { company: facts, roles: storedRoles },
    });
    const before = {
      company: await db.select().from(companies),
      jds: await db.select().from(jobDescriptions), briefs: await db.select().from(manualJdBriefs),
      configs: await db.select().from(companyRoleConfigs), enrichment: await db.select().from(companyEnrichments),
    };
    const report = await seedPracticeProfiles(db, { apply: true, at: AT });
    expect(report.companies.find((row) => row.company === "inventory")).toMatchObject({ profiles: 48, insertedJds: 48, insertedBriefs: 48, insertedConfigs: 7 });
    expect(report.companies.find((row) => row.company === "archived")).toMatchObject({ skipped: true });
    const jds = await db.select().from(jobDescriptions);
    const briefs = await db.select().from(manualJdBriefs);
    const templates = jds.filter((jd) => jd.source === "template");
    expect(jds).toHaveLength(91);
    expect(templates).toHaveLength(48);
    expect(jds.filter((jd) => jd.source === "manual")).toEqual(before.jds);
    expect(briefs.filter((brief) => storedRoles.some((role) => role.id === brief.jdId))).toEqual(before.briefs);
    expect(await db.select().from(companyEnrichments)).toEqual(before.enrichment);
    expect(await db.select().from(companies)).toEqual(before.company);
    expect(await db.select().from(companyRoleConfigs).where(eq(companyRoleConfigs.level, "sde2"))).toEqual(before.configs);
    for (const template of templates) {
      // The level's typical range ("typical for level"), never pay or other hiring facts.
      const [min, max] = LEVEL_EXPERIENCE_YEARS[template.level as EngineeringLevel];
      expect(template).toMatchObject({ active: true, sourceUrl: null, ctcMinLpa: null, ctcMaxLpa: null, ctcSourceCount: null });
      expect([Number(template.yoeMin), template.yoeMax === null ? null : Number(template.yoeMax)]).toEqual([min, max]);
      expect(briefs.find((brief) => brief.jdId === template.id)?.brief).toMatchObject({ provenance: "practice_template", data_confidence: "low", sources: [], published_revision: null });
    }
    const allConfigs = await db.select().from(companyRoleConfigs);
    const again = await seedPracticeProfiles(db, { apply: true, at: new Date("2026-10-04T00:00:00.000Z") });
    expect(again.companies.find((row) => row.company === "inventory")).toMatchObject({ missingJds: 0, missingBriefs: 0, missingConfigs: 0, insertedJds: 0, insertedBriefs: 0, insertedConfigs: 0 });
    expect(await db.select().from(jobDescriptions)).toEqual(jds);
    expect(await db.select().from(manualJdBriefs)).toEqual(briefs);
    expect(await db.select().from(companyRoleConfigs)).toEqual(allConfigs);
    // An older template without a range gets the level's typical one; a set range is never overwritten.
    const [older, kept] = templates;
    await db.update(jobDescriptions).set({ yoeMin: null, yoeMax: null }).where(eq(jobDescriptions.id, older!.id));
    await db.update(jobDescriptions).set({ yoeMin: "7", yoeMax: "9" }).where(eq(jobDescriptions.id, kept!.id));
    const backfill = await seedPracticeProfiles(db, { apply: true, at: new Date("2026-10-04T00:00:00.000Z") });
    expect(backfill.companies.find((row) => row.company === "inventory")).toMatchObject({ missingExperience: 1, filledExperience: 1, insertedJds: 0 });
    const after = await db.select().from(jobDescriptions);
    expect(after.find((jd) => jd.id === older!.id)).toMatchObject({ yoeMin: older!.yoeMin, yoeMax: older!.yoeMax });
    expect(Number(after.find((jd) => jd.id === kept!.id)!.yoeMin)).toBe(7);

    // An admin's subsequent template edits / deactivation must survive a re-run too.
    const edited = templates[0]!;
    await db.update(jobDescriptions).set({ title: "Edited practice template", active: false }).where(eq(jobDescriptions.id, edited.id));
    const [brief] = await db.select().from(manualJdBriefs).where(eq(manualJdBriefs.jdId, edited.id));
    const changedBrief = { ...brief!.brief, final_experience: { ...brief!.brief.final_experience, company_specific_patterns: "Saved custom simulation guidance" } };
    await db.update(manualJdBriefs).set({ brief: changedBrief }).where(eq(manualJdBriefs.jdId, edited.id));
    await seedPracticeProfiles(db, { apply: true, at: AT });
    expect((await db.select().from(jobDescriptions).where(eq(jobDescriptions.id, edited.id)))[0]).toMatchObject({ title: "Edited practice template", active: false });
    expect((await db.select().from(manualJdBriefs).where(eq(manualJdBriefs.jdId, edited.id)))[0]!.brief).toEqual(changedBrief);
  });

  it("rolls back all companies if a later company has a conflicting identity", async () => {
    const db = await database();
    await db.insert(companies).values([{ name: "First", slug: "a-first" }, { name: "Conflict", slug: "z-conflict" }]);
    const [existing] = await db.insert(jobDescriptions).values({
      company: "z-conflict", role: "software-engineer", level: "intern", title: "Existing stored role",
      specialization: "backend", source: "manual", active: true, roleKey: "practice|intern|backend",
    }).returning();
    await expect(seedPracticeProfiles(db, { apply: true, at: AT })).rejects.toThrow("practice identity collides");
    expect(await db.select().from(jobDescriptions)).toEqual([existing]);
    expect(await db.select().from(manualJdBriefs)).toEqual([]);
    expect(await db.select().from(companyRoleConfigs)).toEqual([]);
  });

  it("rechecks active status under the apply transaction and never reactivates an archived company", async () => {
    const db = await database();
    await db.insert(companies).values({ name: "Archived during inventory", slug: "race" });
    const wrapped = new Proxy(db, {
      get(target, property, receiver) {
        if (property === "transaction") return async (callback: Parameters<typeof db.transaction>[0]) => {
          await target.update(companies).set({ status: "archived" }).where(eq(companies.slug, "race"));
          return target.transaction(callback);
        };
        return Reflect.get(target, property, receiver);
      },
    });
    const report = await seedPracticeProfiles(wrapped, { apply: true, at: AT });
    expect(report.companies[0]).toMatchObject({ company: "race", status: "archived", skipped: true, insertedJds: 0 });
    expect(await db.select().from(jobDescriptions)).toEqual([]);
    expect((await db.select().from(companies))[0]!.status).toBe("archived");
  });

  it("supports inventory filtering and rejects unknown slugs before writing", async () => {
    const db = await database();
    await db.insert(companies).values([{ name: "One", slug: "one" }, { name: "Two", slug: "two" }]);
    await expect(seedPracticeProfiles(db, { apply: true, only: ["absent"], at: AT })).rejects.toThrow("not present");
    expect(await db.select().from(jobDescriptions)).toEqual([]);
    const report = await seedPracticeProfiles(db, { apply: true, only: ["two"], at: AT });
    expect(report.companies).toHaveLength(1);
    expect(report.companies[0]!.company).toBe("two");
    expect((await db.select().from(jobDescriptions)).every((jd) => jd.company === "two")).toBe(true);
  });
});
