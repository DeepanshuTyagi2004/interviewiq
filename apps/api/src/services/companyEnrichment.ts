import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/pg/client.js";
import { companies, companyEnrichments, companyRoleConfigs, jobDescriptions, manualJdBriefs, type CompanyRow } from "../db/pg/schema.js";
import { enrichmentBrief, parseEnrichment, type EnrichmentDocument } from "../domain/enrichment.js";
import { ApiError } from "../lib/errors.js";
import { isUpstreamStatus, UpstreamMalformedError, UpstreamTransportError } from "../lib/http.js";
import { isObject } from "../lib/json.js";
import { addProcess, companyPrefill, jdPrefill, mergePrefill, researchRoles } from "./enrichmentPrefill.js";

export interface EnrichmentResearchReader {
  getCompanyDraft(companyId: string, options?: { timeoutMs?: number }): Promise<unknown>;
  fetchBrief(company: string, role: string, level: string, specialization: string | null,
    options?: { timeoutMs?: number; strict?: boolean }): Promise<unknown | null>;
}

const prefillRequest = z.object({ revision: z.number().int().min(0).max(2147483646) }).strict();
const upstream = () => new ApiError(502, "enrichment_source_unavailable", "Available research could not be loaded; your saved draft is unchanged. Try again later.");
// Both the real HTTP client and injected readers are bounded. Four brief lookups at a time,
// at most 50 JDs and a four-second shared budget; no network work runs under a PG lock.
async function bounded<T>(work: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new UpstreamTransportError("Enrichment source timed out")), timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

const missing = () => new ApiError(404, "company_not_found", "no company with that id");
const stale = () => new ApiError(409, "enrichment_stale", "A newer enrichment revision exists; reload before saving");
const response = (r: typeof companyEnrichments.$inferSelect) => ({
  revision: r.revision, publishedRevision: r.publishedRevision,
  publishedAt: r.publishedAt?.toISOString() ?? null, verifiedBy: r.verifiedBy, document: r.document,
});

export class CompanyEnrichmentService {
  constructor(private readonly db: Database, private readonly research?: EnrichmentResearchReader) {}

  async get(companyId: string) {
    const [existing] = await this.db.select().from(companyEnrichments).where(eq(companyEnrichments.companyId, companyId));
    if (existing) return response(existing);
    const document = await this.availableDocument(companyId, false);
    return this.db.transaction(async (tx) => {
      // The company row serializes initial seeding, save, publish and legacy draft approval.
      const [company] = await tx.select().from(companies).where(eq(companies.id, companyId)).for("update");
      if (!company) throw missing();
      const [existing] = await tx.select().from(companyEnrichments).where(eq(companyEnrichments.companyId, companyId));
      if (existing) return response(existing);
      const [row] = await tx.insert(companyEnrichments).values({ companyId, document }).returning();
      return response(row!);
    });
  }

  async prefill(companyId: string, input: unknown) {
    const parsed = prefillRequest.safeParse(input);
    if (!parsed.success) throw new ApiError(400, "invalid_enrichment", "Prefill requires an integer revision and no other fields");
    const { revision } = parsed.data;
    const [before] = await this.db.select().from(companyEnrichments).where(eq(companyEnrichments.companyId, companyId));
    if ((before?.revision ?? 0) !== revision) throw stale();
    const available = await this.availableDocument(companyId, true);
    return this.db.transaction(async (tx) => {
      const [company] = await tx.select().from(companies).where(eq(companies.id, companyId)).for("update");
      if (!company) throw missing();
      const [existing] = await tx.select().from(companyEnrichments).where(eq(companyEnrichments.companyId, companyId));
      if ((existing?.revision ?? 0) !== revision) throw stale();
      const document = existing ? mergePrefill(existing.document, available) : available;
      parseEnrichment({ revision, document }, false);
      if (existing && JSON.stringify(document) === JSON.stringify(existing.document)) return response(existing);
      const [saved] = existing
        ? await tx.update(companyEnrichments).set({ document, revision: revision + 1 })
          .where(and(eq(companyEnrichments.companyId, companyId), eq(companyEnrichments.revision, revision))).returning()
        : await tx.insert(companyEnrichments).values({ companyId, document, revision: revision + 1 }).returning();
      if (!saved) throw stale();
      return response(saved);
    });
  }

  private async availableDocument(companyId: string, strict: boolean): Promise<EnrichmentDocument> {
    const [company] = await this.db.select().from(companies).where(eq(companies.id, companyId));
    if (!company) throw missing();
    const jds = await this.db.select().from(jobDescriptions)
      .where(and(eq(jobDescriptions.company, company.slug), eq(jobDescriptions.active, true)))
      .orderBy(asc(jobDescriptions.id)).limit(50);
    const roles = jds.map(jdPrefill);
    let snapshot: unknown = null;
    let failed = false;
    if (this.research) {
      const reader = this.research, deadline = Date.now() + 4000;
      const read = async (call: (timeoutMs: number) => Promise<unknown>): Promise<unknown> => {
        const timeoutMs = Math.min(1500, deadline - Date.now());
        if (timeoutMs <= 0) { failed = true; return null; }
        try { return await bounded(() => call(timeoutMs), timeoutMs); }
        catch (err) { if (!isUpstreamStatus(err, 404)) failed = true; return null; }
      };
      const draft = read(async (timeoutMs) => {
        const result = await reader.getCompanyDraft(companyId, { timeoutMs });
        if (result === null) return null;
        if (!isObject(result) || !isObject(result.snapshot)) throw new UpstreamMalformedError("Invalid company draft");
        return result.snapshot;
      }).then((result) => { snapshot = result; });
      let next = 0;
      const briefs = new Map<string, Promise<unknown>>();
      const worker = async () => {
        while (next < roles.length) {
          const role = roles[next++]!;
          const key = JSON.stringify([role.role, role.level, role.specialization]);
          if (!briefs.has(key)) briefs.set(key, read(async (timeoutMs) => {
            const result = await reader.fetchBrief(company.slug, role.role, role.level, role.specialization, { timeoutMs, strict: true });
            if (result !== null && !isObject(result)) throw new UpstreamMalformedError("Invalid company brief");
            return result;
          }));
          const brief = await briefs.get(key);
          if (isObject(brief)) addProcess(role, brief.final_experience ?? brief.interview_process, [brief]);
        }
      };
      await Promise.all([draft, ...Array.from({ length: Math.min(4, roles.length) }, worker)]);
    } else if (strict) failed = true;
    if (strict && failed) throw upstream();
    const facts = companyPrefill(company, snapshot);
    const document = mergePrefill({ company: facts, roles }, { company: facts, roles: researchRoles(companyId, snapshot, jds) });
    return parseEnrichment({ revision: 0, document }, false).document;
  }

  async write(companyId: string, input: unknown, actor: string, publish: boolean) {
    const { revision, document } = parseEnrichment(input, publish);
    return this.db.transaction(async (tx) => {
      const [company] = await tx.select().from(companies).where(eq(companies.id, companyId)).for("update");
      if (!company) throw missing();
      if (publish && company.status === "archived") {
        throw new ApiError(409, "company_archived", "Restore this company before publishing enrichment");
      }
      const [existing] = await tx.select().from(companyEnrichments).where(eq(companyEnrichments.companyId, companyId));
      if ((existing?.revision ?? 0) !== revision) throw stale();
      const next = revision + 1;
      // Prep's cache keys include generated_at; even same-millisecond publications invalidate it.
      const now = new Date(Math.max(Date.now(), (existing?.publishedAt?.getTime() ?? 0) + 1));
      if (publish) {
        const owned = await tx.select().from(manualJdBriefs).where(eq(manualJdBriefs.companyId, companyId));
        const keep = new Set<string>();
        for (const role of document.roles) {
          const previous = owned.find((j) => j.roleId === role.id);
          if (previous && role.jdId && previous.jdId !== role.jdId) throw new ApiError(400, "invalid_enrichment", "A published role cannot change its JD identity");
          const jdId = previous?.jdId ?? role.jdId ?? randomUUID();
          const [jd] = await tx.select().from(jobDescriptions).where(eq(jobDescriptions.id, jdId));
          if (role.jdId && !jd) throw new ApiError(400, "invalid_enrichment", "Referenced JD does not exist");
          if (jd && jd.company !== company.slug) throw new ApiError(400, "invalid_enrichment", "Referenced JD belongs to another company");
          // Identity is immutable for every existing JD, including adopted seed JDs. This also
          // closes the concurrent-booking race: a booking can never capture a superseded identity.
          role.specialization = role.specialization || null;
          if (jd && (jd.role !== role.role || jd.level !== role.level || jd.specialization !== role.specialization)) {
            throw new ApiError(409, "enrichment_identity_conflict", "An existing JD's role, level and specialization are immutable; add a new role instead");
          }
          if (owned.some((o) => o.jdId === jdId && o.roleId !== role.id)) throw new ApiError(400, "invalid_enrichment", "A JD cannot be reassigned to a different role identity");
          const data = {
            company: company.slug, role: role.role, level: role.level, title: role.title,
            specialization: role.specialization || null, description: role.description, techStack: role.techStack.join(", "),
            // Legacy relational column is 255 chars; full evidence lives in the JSON document/brief.
            sourceUrl: role.sourceUrls.find((url) => url.length <= 255) ?? null,
            source: "manual", active: true, roleKey: `manual-${role.id}`,
            yoeMin: role.yoeMin?.toFixed(1) ?? null, yoeMax: role.yoeMax?.toFixed(1) ?? null,
            ctcMinLpa: role.ctcMinLpa?.toFixed(2) ?? null, ctcMaxLpa: role.ctcMaxLpa?.toFixed(2) ?? null,
          };
          if (jd) await tx.update(jobDescriptions).set(data).where(eq(jobDescriptions.id, jdId));
          else await tx.insert(jobDescriptions).values({ id: jdId, ...data });
          role.jdId = jdId;
          const brief = enrichmentBrief(company.slug, role, document.company, next, now);
          await tx.insert(manualJdBriefs).values({ jdId, companyId, roleId: role.id, brief })
            .onConflictDoUpdate({ target: manualJdBriefs.jdId, set: { brief } });
          const config = { company: company.slug, role: role.role, level: role.level, title: role.title,
            jdDescription: role.description, techStack: role.techStack.join(", "), roundCount: role.rounds.length, enabled: true };
          await tx.insert(companyRoleConfigs).values(config).onConflictDoUpdate({
            target: [companyRoleConfigs.company, companyRoleConfigs.role, companyRoleConfigs.level], set: config,
          });
          keep.add(jdId);
        }
        const removed = owned.filter((r) => !keep.has(r.jdId)).map((r) => r.jdId);
        if (removed.length) await tx.update(jobDescriptions).set({ active: false }).where(inArray(jobDescriptions.id, removed));
        await tx.update(companies).set({ publishedAt: now, publishedVersion: next }).where(eq(companies.id, companyId));
      }
      const data = {
        revision: next, document,
        ...(publish ? { publishedDocument: document, publishedRevision: next, publishedAt: now, verifiedBy: actor } : {}),
      };
      const [saved] = existing
        ? await tx.update(companyEnrichments).set(data).where(and(eq(companyEnrichments.companyId, companyId), eq(companyEnrichments.revision, revision))).returning()
        : await tx.insert(companyEnrichments).values({ companyId, ...data }).returning();
      if (!saved) throw stale();
      return response(saved);
    });
  }

  async briefForJd(jdId: string) {
    const [row] = await this.db.select().from(manualJdBriefs).where(eq(manualJdBriefs.jdId, jdId));
    return row?.brief ?? null;
  }

  async publishedJdIds(): Promise<Set<string>> {
    return new Set((await this.db.select({ id: manualJdBriefs.jdId }).from(manualJdBriefs)).map((r) => r.id));
  }

  /** A legacy AI approval cannot race a manual publish or overwrite its company facts. */
  async approveResearch(companyId: string, patch: Partial<typeof companies.$inferInsert>): Promise<CompanyRow | null> {
    return this.db.transaction(async (tx) => {
      const [company] = await tx.select().from(companies).where(eq(companies.id, companyId)).for("update");
      if (!company) return null;
      const [manual] = await tx.select().from(companyEnrichments).where(eq(companyEnrichments.companyId, companyId));
      if (manual?.publishedRevision !== null && manual?.publishedRevision !== undefined) {
        throw new ApiError(409, "manual_enrichment_protected", "This company has verified manual enrichment; copy selected suggestions into the enrichment editor instead");
      }
      const [saved] = await tx.update(companies).set(patch).where(eq(companies.id, companyId)).returning();
      return saved ?? null;
    });
  }
}
