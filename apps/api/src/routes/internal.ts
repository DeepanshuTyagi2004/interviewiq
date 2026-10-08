import type { Router } from "express";
import type { Container } from "../container.js";
import { requireInternalKey } from "../http/security.js";
import { router } from "../http/support.js";

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

  /**
   * Named problems from the admin-published briefs, for the AI service's problem-bank collector
   * (docs/question-bank.md): one entry per brief, only rounds that carry problems.
   */
  r.get("/brief-problems", async (_req, res) => {
    const briefs = [...(await c.enrichment.briefsByJd()).values()]
      .map((b) => ({ company: b.company, final_experience: { rounds: b.final_experience.rounds.filter((r) => r.problems.length).map((r) => ({ type: r.type, difficulty: r.difficulty, topics: r.topics, problems: r.problems })) } }))
      .filter((b) => b.final_experience.rounds.length);
    res.json({ briefs });
  });

  /** Company research targets: every ACTIVE company, published or not (spec §8.1). */
  r.get("/research-targets", async (_req, res) => {
    const rows = await c.repos.companies.findActive();
    res.json(rows.map((co) => ({ id: co.id, name: co.name, slug: co.slug, website: co.website, aliases: co.aliases })));
  });

  return r;
}
