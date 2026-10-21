import type { Router } from "express";
import type { Container } from "../container.js";
import { ROLES, type Role } from "../domain/enums.js";
import { str } from "../domain/candidateProfile.js";
import { COMPANY_STATUSES, companies, type CompanyRow, type CompanyStatus } from "../db/pg/schema.js";
import { slugify } from "../domain/slug.js";
import { ApiError } from "../lib/errors.js";
import { isObject, items, path } from "../lib/json.js";
import { sendError, uuidParam, stringParam, userId, routerErrors, router } from "../http/support.js";
import { UpstreamError, UpstreamHttpError } from "../lib/http.js";
import { toUserResponse } from "../services/userService.js";
import { companyDraftPublication } from "../services/companyDraftPublication.js";

const MAX_ALIASES = 10;
const MAX_ALIAS_LENGTH = 100;

/** The AI service's per-company research state (spec §4.2 company_research_state). */
interface ResearchState {
  company_id: string;
  last_run_id?: string | null;
  last_researched_at?: string | null;
  last_status?: string | null;
  latest_draft_id?: string | null;
  latest_draft_status?: string | null;
  latest_draft_coverage?: { filled: number; total: number } | null;
}

function toAdminCompany(row: CompanyRow, state: ResearchState | undefined) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    website: row.website,
    aliases: row.aliases,
    status: row.status,
    origin: row.origin,
    tier: row.tier,
    publishedVersion: row.publishedVersion,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    research: state
      ? {
          lastRunId: state.last_run_id ?? null,
          lastResearchedAt: state.last_researched_at ?? null,
          lastStatus: state.last_status ?? null,
          latestDraftId: state.latest_draft_id ?? null,
          latestDraftStatus: state.latest_draft_status ?? null,
          latestDraftCoverage: state.latest_draft_coverage ?? null,
        }
      : null,
  };
}

function parseName(raw: unknown): { name: string; slug: string } {
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  const slug = slugify(name);
  if (!name || name.length > 255 || !slug) {
    throw new ApiError(400, "invalid_company", "name is required (up to 255 characters, with at least one letter or digit)");
  }
  return { name, slug };
}

function parseWebsite(raw: unknown): string | null {
  if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) return null;
  const invalid = new ApiError(400, "invalid_website", "website must be an http(s) URL like https://meesho.com");
  if (typeof raw !== "string") throw invalid;
  const trimmed = raw.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw invalid;
  }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".") || /\s/.test(trimmed) || withScheme.length > 255) {
    throw invalid;
  }
  return withScheme;
}

function parseAliases(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.some((a) => typeof a !== "string")) {
    throw new ApiError(400, "invalid_aliases", "aliases must be a list of strings");
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const alias of raw as string[]) {
    const clean = alias.trim().replace(/\s+/g, " ");
    if (!clean) continue;
    if (clean.length > MAX_ALIAS_LENGTH) throw new ApiError(400, "invalid_aliases", `each alias is at most ${MAX_ALIAS_LENGTH} characters`);
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  if (out.length > MAX_ALIASES) throw new ApiError(400, "invalid_aliases", `at most ${MAX_ALIASES} aliases`);
  return out;
}

/**
 * Admin company catalogue (Intelligence → Companies): the curated list the research job works
 * through. A new company starts unpublished: students see it only after an admin approves its
 * first research draft (Phase 2). The slug is fixed at creation; it joins JDs, briefs and research.
 */
export function adminCompaniesRouter(c: Container): Router {
  const r = router();

  /** Load the starter catalogue on demand. Idempotent, upsert-only. Does NOT trigger research. */
  r.post("/seed", async (_req, res) => {
    res.json(await c.seeder.seed());
  });

  r.get("/", async (_req, res) => {
    const rows = await c.repos.companies.findAll();
    const states = rows.length > 0 ? await c.aiService.companyResearchStates(rows.map((row) => row.id)) : { states: [] };
    const byId = new Map<string, ResearchState>();
    for (const s of items(path(states, "states"))) {
      if (isObject(s) && typeof s.company_id === "string") byId.set(s.company_id, s as unknown as ResearchState);
    }
    res.json({ companies: rows.map((row) => toAdminCompany(row, byId.get(row.id))), researchAvailable: states !== null });
  });

  r.post("/", async (req, res) => {
    const b = isObject(req.body) ? req.body : {};
    const { name, slug } = parseName(b.name);
    const website = parseWebsite(b.website);
    const aliases = parseAliases(b.aliases);
    if (await c.repos.companies.findBySlug(slug)) {
      sendError(res, 409, "company_exists", `a company with the slug "${slug}" already exists`);
      return;
    }
    const row = await c.repos.companies.create({ name, slug, website, aliases, origin: "admin" });
    res.status(201).json(toAdminCompany(row, undefined));
  });

  r.patch("/:id", async (req, res) => {
    const id = uuidParam(req, "id");
    const b = isObject(req.body) ? req.body : {};
    const patch: Partial<typeof companies.$inferInsert> = {};
    if ("name" in b) patch.name = parseName(b.name).name;
    if ("website" in b) patch.website = parseWebsite(b.website);
    if ("aliases" in b) patch.aliases = parseAliases(b.aliases);
    if ("status" in b) {
      if (typeof b.status !== "string" || !(COMPANY_STATUSES as readonly string[]).includes(b.status)) {
        throw new ApiError(400, "invalid_status", `status must be one of [${COMPANY_STATUSES.join(", ")}]`);
      }
      patch.status = b.status as CompanyStatus;
    }
    const row = Object.keys(patch).length > 0 ? await c.repos.companies.update(id, patch) : await c.repos.companies.findById(id);
    if (!row) {
      sendError(res, 404, "company_not_found", "no company with that id");
      return;
    }
    res.json(toAdminCompany(row, undefined));
  });

  r.get("/:id/enrichment", async (req, res) => {
    res.json(await c.enrichment.get(uuidParam(req, "id")));
  });
  r.put("/:id/enrichment", async (req, res) => {
    res.json(await c.enrichment.write(uuidParam(req, "id"), req.body, userId(req), false));
  });
  r.post("/:id/enrichment/prefill", async (req, res) => {
    res.json(await c.enrichment.prefill(uuidParam(req, "id"), req.body));
  });
  r.post("/:id/enrichment/publish", async (req, res) => {
    res.json(await c.enrichment.write(uuidParam(req, "id"), req.body, userId(req), true));
  });

  /** The newest research draft (any status), for the admin review view. 404 when none exists yet. */
  r.get("/:id/draft", async (req, res) => {
    const id = uuidParam(req, "id");
    const row = await c.repos.companies.findById(id);
    if (!row) {
      sendError(res, 404, "company_not_found", "no company with that id");
      return;
    }
    res.json({ company: toAdminCompany(row, undefined), draft: await c.aiService.getCompanyDraft(id) });
  });

  /**
   * Approve a pending draft: copy its identity, profile and compensation onto the company, stamp
   * publishedVersion/publishedAt (students see the company from here), then close the draft.
   * The company write is idempotent, so a failure on the last step is safe to retry.
   */
  r.post("/:id/draft/:draftId/approve", async (req, res) => {
    const id = uuidParam(req, "id");
    const draft = await pendingDraft(c, id, stringParam(req, "draftId"));
    const blocking = draftConflicts(draft).find((x) => x === "not_a_company");
    if (blocking) throw new ApiError(409, "draft_not_approvable", "research says this is not a company; reject the draft instead");
    const identity = path(draft, "snapshot", "identity");
    const name = path(identity, "name", "value");
    const website = path(identity, "website", "value");
    const aliases = path(identity, "aliases", "value");
    const version = path(draft, "version");
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1 || version > 2_147_483_647) {
      throw new ApiError(400, "invalid_draft", "draft version must be a positive integer");
    }
    const patch: Partial<typeof companies.$inferInsert> = {
      ...companyDraftPublication(path(draft, "snapshot")),
      publishedVersion: version,
      publishedAt: new Date(),
    };
    if (typeof name === "string") patch.name = parseName(name).name;
    if (typeof website === "string") patch.website = parseWebsite(website);
    if (Array.isArray(aliases)) patch.aliases = parseAliases(aliases);
    const row = await c.enrichment.approveResearch(id, patch);
    if (!row) {
      sendError(res, 404, "company_not_found", "no company with that id");
      return;
    }
    await c.aiService.decideCompanyDraft(String(path(draft, "draft_id")), {
      decision: "approve", note: bodyNote(req.body), decided_by: userId(req),
    });
    res.json(toAdminCompany(row, undefined));
  });

  r.post("/:id/draft/:draftId/reject", async (req, res) => {
    const id = uuidParam(req, "id");
    const draft = await pendingDraft(c, id, stringParam(req, "draftId"));
    await c.aiService.decideCompanyDraft(String(path(draft, "draft_id")), {
      decision: "reject", note: bodyNote(req.body), decided_by: userId(req),
    });
    res.status(204).end();
  });

  r.delete("/:id", async (req, res) => {
    const id = uuidParam(req, "id");
    const row = await c.repos.companies.findById(id);
    if (!row) {
      sendError(res, 404, "company_not_found", "no company with that id");
      return;
    }
    await c.repos.jds.deleteByCompany(row.slug);
    await c.repos.roleConfigs.deleteByCompany(row.slug);
    await c.repos.companies.deleteById(id);
    res.status(204).end();
  });

  r.use(
    routerErrors((err) => {
      if (err instanceof UpstreamHttpError && [404, 409, 503].includes(err.status)) {
        const body = parseUpstreamEnvelope(err.responseBody);
        return { status: err.status, code: body.code ?? "research_request_failed", message: body.message ?? err.message };
      }
      if (err instanceof UpstreamError) return { status: 502, code: "ai_service_unreachable", message: "the research service is not reachable" };
      return undefined;
    }),
  );
  return r;
}

/** The company's latest draft, which must be `draftId` and still pending review (409 otherwise). */
async function pendingDraft(c: Container, companyId: string, draftId: string): Promise<unknown> {
  if (!(await c.repos.companies.findById(companyId))) throw new ApiError(404, "company_not_found", "no company with that id");
  const draft = await c.aiService.getCompanyDraft(companyId);
  if (path(draft, "company_id") !== companyId) throw new ApiError(409, "draft_stale", "draft belongs to another company; reload the company");
  if (path(draft, "draft_id") !== draftId) throw new ApiError(409, "draft_stale", "a newer draft exists; reload and review that one");
  if (path(draft, "status") !== "pending_review") throw new ApiError(409, "draft_not_pending", `this draft is already ${String(path(draft, "status"))}`);
  return draft;
}

function draftConflicts(draft: unknown): string[] {
  return items(path(draft, "conflicts")).flatMap((x) => (isObject(x) && typeof x.type === "string" ? [x.type] : []));
}

function bodyNote(body: unknown): string | null {
  const note = isObject(body) ? str(body.note) : null;
  return note ? note.trim().slice(0, 1000) || null : null;
}

function parseUpstreamEnvelope(text: string): { code?: string; message?: string } {
  try {
    const v: unknown = JSON.parse(text);
    if (!isObject(v)) return {};
    return { code: typeof v.code === "string" ? v.code : undefined, message: typeof v.message === "string" ? v.message : undefined };
  } catch {
    return {};
  }
}

/** Admin user management — list users and promote/demote their role. */
export function adminUsersRouter(c: Container): Router {
  const r = router();

  r.get("/", async (_req, res) => {
    res.json((await c.users.listUsers()).map(toUserResponse));
  });

  r.patch("/:id/role", async (req, res) => {
    const id = uuidParam(req, "id");
    const raw = isObject(req.body) ? str(req.body.role) : null;
    const role = raw?.trim().toUpperCase();
    if (!role || !(ROLES as readonly string[]).includes(role)) {
      sendError(res, 400, "invalid_role", "role must be USER, CANDIDATE or ADMIN");
      return;
    }
    const user = await c.users.updateRole(id, role as Role);
    if (!user) {
      sendError(res, 404, "user_not_found", "no user with that id");
      return;
    }
    res.json(toUserResponse(user));
  });

  return r;
}
