import type { Router } from "express";
import type { Container } from "../container.js";
import { LEVELS, ROLES, type Role } from "../domain/enums.js";
import { str } from "../domain/candidateProfile.js";
import { UpstreamError } from "../lib/http.js";
import { isBlank, isObject, items } from "../lib/json.js";
import { sendError, stringParam, uuidParam, router } from "../http/support.js";
import { toUserResponse } from "../services/userService.js";

const DEFAULT_ROLE = "software-engineer";
const DEFAULT_SPECIALIZATION = "general";

const slug = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "-");

/**
 * Admin catalogue management (ingestion page): add a company + its JDs, list, delete, and load the
 * starter catalogue. The catalogue IS the job_descriptions table the student Jobs page shows.
 */
export function adminCompaniesRouter(c: Container): Router {
  const r = router();

  /** Load the starter catalogue on demand. Idempotent. Does NOT trigger ingestion. */
  r.post("/seed", async (_req, res) => {
    res.json(await c.seeder.seed());
  });

  r.get("/", async (_req, res) => {
    const byCompany = new Map<string, unknown[]>();
    for (const j of await c.repos.jds.findAllActiveOrdered()) {
      if (!byCompany.has(j.company)) byCompany.set(j.company, []);
      byCompany.get(j.company)!.push({
        id: j.id,
        role: j.role,
        level: j.level,
        specialization: j.specialization,
        title: j.title,
        jdUrl: j.sourceUrl,
        description: j.description,
        enabled: j.active,
      });
    }
    res.json([...byCompany.entries()].map(([company, jds]) => ({ company, jds })));
  });

  r.post("/", async (req, res) => {
    const b = isObject(req.body) ? req.body : null;
    const companyRaw = str(b?.company);
    const jdsRaw = b && Array.isArray(b.jds) ? b.jds : null;
    if (isBlank(companyRaw) || !jdsRaw || jdsRaw.length === 0) {
      sendError(res, 400, "invalid_company", "company and at least one JD are required");
      return;
    }
    const company = slug(companyRaw);

    // Validate everything first so a bad JD doesn't leave a half-saved company behind.
    const toSave = [];
    for (const raw of items(jdsRaw)) {
      const jd = isObject(raw) ? raw : null;
      const title = str(jd?.title);
      const levelRaw = str(jd?.level);
      if (jd === null || isBlank(title) || isBlank(levelRaw)) {
        sendError(res, 400, "invalid_jd", "each JD needs a title and a level");
        return;
      }
      const level = levelRaw.trim().toLowerCase();
      if (!(LEVELS as readonly string[]).includes(level)) {
        sendError(res, 400, "invalid_level", `level must be one of [${LEVELS.join(", ")}]`);
        return;
      }
      const role = str(jd.role);
      const specialization = str(jd.specialization);
      const description = str(jd.description);
      const jdUrl = str(jd.jdUrl);
      toSave.push({
        company,
        role: isBlank(role) ? DEFAULT_ROLE : slug(role),
        level,
        title: title.trim(),
        specialization: isBlank(specialization) ? DEFAULT_SPECIALIZATION : specialization.trim().toLowerCase(),
        description: isBlank(description) ? null : description.trim(),
        techStack: null,
        sourceUrl: isBlank(jdUrl) ? null : jdUrl.trim(),
        source: "seed",
        active: true,
      });
    }

    const saved = [];
    for (const row of toSave) {
      const p = await c.repos.jds.insert(row);
      saved.push({
        id: p.id,
        role: p.role,
        level: p.level,
        specialization: p.specialization,
        title: p.title,
        jdUrl: p.sourceUrl,
        description: p.description,
        enabled: true,
      });
    }

    // Kick off ingestion for the new JDs; non-fatal if the AI service is down.
    let ingestionTriggered = true;
    try {
      await c.aiService.triggerScrape();
    } catch (err) {
      if (!(err instanceof UpstreamError)) throw err;
      ingestionTriggered = false;
      c.log.warn(`Added ${saved.length} JD(s) for ${company} but could not trigger ingestion: ${err.message}`);
    }

    res.status(201).json({ company, jds: saved, ingestion_triggered: ingestionTriggered });
  });

  r.delete("/:company", async (req, res) => {
    const s = slug(stringParam(req, "company"));
    await c.repos.jds.deleteByCompany(s);
    await c.repos.companies.deleteBySlug(s);
    res.status(204).end();
  });

  return r;
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
      sendError(res, 400, "invalid_role", "role must be USER or ADMIN");
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
