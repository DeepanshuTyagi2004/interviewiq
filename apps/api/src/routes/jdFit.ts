import type { Router } from "express";
import type { Container } from "../container.js";
import { isEngineeringLevel } from "../domain/engineeringLevels.js";
import { queryString, router, sendError, userId, uuidParam } from "../http/support.js";

/**
 * The signed-in user's JD fit (`docs/jd-fit.md`): `GET /` scores the role cards (same filters as
 * `GET /jds`), `GET /{jdId}` explains one score part by part.
 */
export function jdFitRouter(c: Container): Router {
  const r = router();

  r.get("/", async (req, res) => {
    const level = queryString(req, "level");
    if (level !== null && !isEngineeringLevel(level)) { sendError(res, 400, "invalid_level", "Choose a valid engineering level"); return; }
    res.json(await c.jdFit.list(userId(req), { company: queryString(req, "company"), level, specialization: queryString(req, "specialization") }));
  });

  r.get("/:id", async (req, res) => {
    const result = await c.jdFit.one(userId(req), uuidParam(req, "id"));
    if (!result) { sendError(res, 404, "jd_not_found", "no JD with that id"); return; }
    res.json(result);
  });

  return r;
}
