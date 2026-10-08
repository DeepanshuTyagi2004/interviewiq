import type { Router } from "express";
import type { Container } from "../container.js";
import { isObject } from "../lib/json.js";
import { router, routerErrors, userId, uuidParam } from "../http/support.js";

const body = (b: unknown): Record<string, unknown> => (isObject(b) ? b : {});

/** Confirmed loops: one per user and JD, each a snapshot of a process graph. */
export function loopsRouter(c: Container): Router {
  const r = router();
  r.get("/", async (req, res) => { res.json(await c.loops.listLoops(userId(req))); });
  r.post("/", async (req, res) => { res.status(201).json(await c.loops.confirmLoop(userId(req), body(req.body))); });
  r.get("/:id", async (req, res) => { res.json(await c.loops.getLoop(userId(req), uuidParam(req, "id"))); });
  r.patch("/:id", async (req, res) => { res.json(await c.loops.setLoopStatus(userId(req), uuidParam(req, "id"), body(req.body).status)); });
  r.use(routerErrors(() => undefined));
  return r;
}

/** A user's saved custom processes, plus each JD's read-only official process. */
export function processesRouter(c: Container): Router {
  const r = router();
  r.get("/", async (req, res) => { res.json(await c.loops.listProcesses(userId(req))); });
  r.post("/", async (req, res) => { res.status(201).json(await c.loops.createProcess(userId(req), body(req.body))); });
  // Declared before "/:id" so "official" is not parsed as an id.
  r.get("/official/:jdId", async (req, res) => { res.json({ graph: await c.loops.officialGraph(uuidParam(req, "jdId")) }); });
  r.get("/:id", async (req, res) => { res.json(await c.loops.getProcess(userId(req), uuidParam(req, "id"))); });
  r.put("/:id", async (req, res) => { res.json(await c.loops.updateProcess(userId(req), uuidParam(req, "id"), body(req.body))); });
  r.post("/:id/duplicate", async (req, res) => { res.status(201).json(await c.loops.duplicateProcess(userId(req), uuidParam(req, "id"))); });
  r.delete("/:id", async (req, res) => { await c.loops.deleteProcess(userId(req), uuidParam(req, "id")); res.status(204).end(); });
  r.use(routerErrors(() => undefined));
  return r;
}

/** The watchlist, and the per-JD status (targeted? live loop?) the JD page needs. */
export function targetsRouter(c: Container): Router {
  const r = router();
  r.get("/", async (req, res) => { res.json(await c.loops.listTargets(userId(req))); });
  r.get("/status/:jdId", async (req, res) => { res.json(await c.loops.jdStatus(userId(req), uuidParam(req, "jdId"))); });
  r.put("/:jdId", async (req, res) => { await c.loops.addTarget(userId(req), uuidParam(req, "jdId")); res.status(204).end(); });
  r.delete("/:jdId", async (req, res) => { await c.loops.removeTarget(userId(req), uuidParam(req, "jdId")); res.status(204).end(); });
  r.use(routerErrors(() => undefined));
  return r;
}
