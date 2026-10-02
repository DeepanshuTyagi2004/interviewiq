import type { Router } from "express";
import type { Container } from "../container.js";
import { BadRequestError } from "../lib/errors.js";
import { requireInternalKey } from "../http/security.js";
import { requiredBody, router, uuidParam } from "../http/support.js";
import { isObject } from "../lib/json.js";

/**
 * Service-to-service endpoints (AI service / live-interview worker → API). Not JWT-authed; guarded
 * by the shared X-Internal-Api-Key.
 */
export function internalRouter(c: Container): Router {
  const r = router();
  r.use(requireInternalKey(c.config.internalApiKey));

  /** Brief-generation targets — one per active JD = (company, role, level, specialization). */
  r.get("/scrape-targets", async (_req, res) => {
    const jds = await c.repos.jds.findAllActiveOrdered();
    res.json(
      jds.map((j) => ({
        company: j.company,
        role: j.role,
        level: j.level,
        specialization: j.specialization,
        title: j.title,
        jdUrl: j.sourceUrl,
        description: j.description,
      })),
    );
  });

  /** Company research targets: every ACTIVE company, published or not (spec §8.1). */
  r.get("/research-targets", async (_req, res) => {
    const rows = await c.repos.companies.findActive();
    res.json(rows.map((co) => ({ id: co.id, name: co.name, slug: co.slug, website: co.website, aliases: co.aliases })));
  });

  /** Called once when an interview ends: persist the SessionOutcome and finalize the session. */
  r.post("/sessions/:sessionId/outcome", async (req, res) => {
    const sessionId = uuidParam(req, "sessionId");
    const outcome = requiredBody(req);
    if (!isObject(outcome)) throw new BadRequestError("the SessionOutcome must be a JSON object");
    await c.liveSessions.recordOutcome(sessionId, outcome);
    res.status(204).end();
  });

  return r;
}
