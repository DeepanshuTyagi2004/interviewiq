import type { InterviewProcessRow, JobDescriptionRow, LoopRow } from "../db/pg/schema.js";
import { linearGraph, nodeStates, parseProcessGraph, progressOf, type ProcessGraph } from "../domain/process.js";
import { ApiError } from "../lib/errors.js";
import { isObject } from "../lib/json.js";
import type {
  CompanyRepository,
  InterviewSessionRepository,
  JobDescriptionRepository,
  LoopRepository,
  ProcessRepository,
  TargetRepository,
} from "../repositories/pg.js";
import type { CompanyEnrichmentService } from "./companyEnrichment.js";

const MAX_PROCESSES_PER_USER = 50;
const MAX_TARGETS_PER_USER = 200;

const bad = (code: string, message: string) => new ApiError(400, code, message);
const conflict = (code: string, message: string) => new ApiError(409, code, message);
const notFound = (code: string, message: string) => new ApiError(404, code, message);

export interface JdBrief {
  jdId: string;
  title: string;
  company: string;
  companyName: string;
  role: string;
  level: string;
  specialization: string | null;
  techStack: string[];
}

export type FetchBrief = (company: string, role: string, level: string, specialization: string | null) => Promise<unknown | null>;

const csv = (v: string | null) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** The brief's ordered rounds, current (`final_experience`) or legacy (`consolidated_process`). */
function briefRounds(brief: unknown): unknown[] {
  if (!isObject(brief)) return [];
  for (const k of ["final_experience", "consolidated_process"]) {
    const block = brief[k];
    if (isObject(block) && Array.isArray(block.rounds)) return block.rounds;
  }
  return [];
}

export class LoopService {
  constructor(
    private readonly processes: ProcessRepository,
    private readonly loops: LoopRepository,
    private readonly targets: TargetRepository,
    private readonly sessions: InterviewSessionRepository,
    private readonly jds: JobDescriptionRepository,
    private readonly companies: CompanyRepository,
    private readonly enrichment: CompanyEnrichmentService,
    private readonly fetchBrief: FetchBrief,
  ) {}

  // --- JD helpers ---------------------------------------------------------------------------------

  private async activeJd(jdId: string): Promise<JobDescriptionRow> {
    const jd = await this.jds.findById(jdId);
    if (!jd || !jd.active) throw notFound("jd_not_found", "no JD with that id");
    return jd;
  }

  private async briefs(rows: JobDescriptionRow[]): Promise<Map<string, JdBrief>> {
    const companies = await this.companies.findAllBySlug(rows.map((j) => j.company));
    const names = new Map(companies.map((c) => [c.slug, c.name]));
    return new Map(rows.map((j) => [j.id, {
      jdId: j.id, title: j.title, company: j.company, companyName: names.get(j.company) ?? j.company,
      role: j.role, level: j.level, specialization: j.specialization, techStack: csv(j.techStack),
    }]));
  }

  private async jdBriefs(ids: string[]): Promise<Map<string, JdBrief>> {
    const rows = (await Promise.all([...new Set(ids)].map((id) => this.jds.findById(id)))).filter((j): j is JobDescriptionRow => !!j);
    return this.briefs(rows);
  }

  /** The JD's suggested process as a graph. Never stored per user; read-only for everyone. */
  async officialGraph(jdId: string): Promise<ProcessGraph> {
    const jd = await this.activeJd(jdId);
    const brief = (await this.enrichment.briefForJd(jd.id)) ?? (await this.fetchBrief(jd.company, jd.role, jd.level, jd.specialization));
    const rounds = briefRounds(brief).filter(isObject).map((r, i) => ({
      id: str(r.id) ?? `round-${i + 1}`,
      name: str(r.name) ?? `Round ${i + 1}`,
      type: str(r.type),
      kind: str(r.kind),
      durationMinutes: num(r.duration_minutes),
      difficulty: str(r.difficulty),
      topics: strings(r.topics ?? r.dominant_topics),
      note: str(r.format) ?? undefined,
    }));
    return linearGraph(rounds);
  }

  // --- processes ----------------------------------------------------------------------------------

  private processView(p: InterviewProcessRow, jd: JdBrief | undefined) {
    return { id: p.id, name: p.name, jd: jd ?? null, graph: p.graph, createdAt: p.createdAt, updatedAt: p.updatedAt };
  }

  async listProcesses(userId: string) {
    const rows = await this.processes.findAllByUser(userId);
    const jds = await this.jdBriefs(rows.map((p) => p.jdId));
    return { processes: rows.map((p) => this.processView(p, jds.get(p.jdId))) };
  }

  async getProcess(userId: string, id: string) {
    const p = await this.ownedProcess(userId, id);
    return this.processView(p, (await this.jdBriefs([p.jdId])).get(p.jdId));
  }

  private async ownedProcess(userId: string, id: string): Promise<InterviewProcessRow> {
    const p = await this.processes.findOwned(id, userId);
    if (!p) throw notFound("process_not_found", "no process with that id");
    return p;
  }

  private cleanName(raw: unknown): string {
    const name = typeof raw === "string" ? raw.trim() : "";
    if (name === "" || name.length > 120) throw bad("invalid_process", "name is required (max 120 characters)");
    return name;
  }

  /** New saved process for a JD; starts as a copy of the official process unless a graph is sent. */
  async createProcess(userId: string, body: { jdId: unknown; name: unknown; graph?: unknown }) {
    if (typeof body.jdId !== "string") throw bad("invalid_process", "jdId is required");
    const jd = await this.activeJd(body.jdId.toLowerCase());
    if ((await this.processes.findAllByUser(userId)).length >= MAX_PROCESSES_PER_USER) {
      throw conflict("process_limit", `You can save up to ${MAX_PROCESSES_PER_USER} processes`);
    }
    const graph = body.graph === undefined ? parseProcessGraph(await this.officialGraph(jd.id)) : parseProcessGraph(body.graph);
    const row = await this.processes.insert({ userId, jdId: jd.id, name: this.cleanName(body.name), graph });
    return this.processView(row, (await this.jdBriefs([jd.id])).get(jd.id));
  }

  async updateProcess(userId: string, id: string, body: { name?: unknown; graph?: unknown }) {
    const p = await this.ownedProcess(userId, id);
    const patch: { name?: string; graph?: ProcessGraph } = {};
    if (body.name !== undefined) patch.name = this.cleanName(body.name);
    if (body.graph !== undefined) patch.graph = parseProcessGraph(body.graph);
    const row = (await this.processes.update(p.id, patch)) ?? p;
    return this.processView(row, (await this.jdBriefs([row.jdId])).get(row.jdId));
  }

  async duplicateProcess(userId: string, id: string) {
    const p = await this.ownedProcess(userId, id);
    return this.createProcess(userId, { jdId: p.jdId, name: `${p.name} (copy)`.slice(0, 120), graph: p.graph });
  }

  async deleteProcess(userId: string, id: string): Promise<void> {
    const p = await this.ownedProcess(userId, id);
    await this.processes.delete(p.id); // loops keep their own snapshot; process_id is set null
  }

  // --- loops --------------------------------------------------------------------------------------

  /** Confirm a process for a JD: snapshot it as a loop. Custom processes become standalone loops. */
  async confirmLoop(userId: string, body: { jdId: unknown; processId?: unknown }) {
    if (typeof body.jdId !== "string") throw bad("invalid_loop", "jdId is required");
    const jd = await this.activeJd(body.jdId.toLowerCase());
    let graph: ProcessGraph;
    let processId: string | null = null;
    if (body.processId === undefined || body.processId === null) {
      const official = await this.officialGraph(jd.id);
      if (!official.nodes.some((n) => n.kind === "round")) {
        throw conflict("no_official_process", "This role has no interview process to confirm yet");
      }
      graph = parseProcessGraph(official);
    } else {
      if (typeof body.processId !== "string") throw bad("invalid_loop", "processId must be a string");
      const p = await this.ownedProcess(userId, body.processId.toLowerCase());
      if (p.jdId !== jd.id) throw bad("invalid_loop", "that process belongs to a different role");
      graph = parseProcessGraph(p.graph);
      processId = p.id;
    }
    const row = await this.loops.insertIfNoLiveLoop({ userId, jdId: jd.id, processId, kind: processId ? "standalone" : "official", status: "active", graph });
    if (!row) throw conflict("loop_exists", "You already have a live loop for this role");
    await this.targets.remove(userId, jd.id);
    return this.loopView(row, [], (await this.jdBriefs([jd.id])).get(jd.id));
  }

  private loopView(l: LoopRow, sessions: { id: string; loopId: string | null; nodeId: string | null; status: string; scheduledAt: Date }[], jd: JdBrief | undefined) {
    const mine = sessions.filter((s) => s.loopId === l.id);
    const states = nodeStates(l.graph, mine);
    return {
      id: l.id, jd: jd ?? null, jdId: l.jdId, processId: l.processId, kind: l.kind, status: l.status,
      /** Only unedited, suggested processes count toward readiness. */
      countsTowardReadiness: l.kind === "official",
      confirmedAt: l.confirmedAt, graph: l.graph,
      nodeStates: Object.fromEntries(states),
      progress: progressOf(l.graph, mine),
      sessions: mine.map((s) => ({ id: s.id, nodeId: s.nodeId, status: s.status, scheduledAt: s.scheduledAt })),
    };
  }

  /** A finished loop (every round completed) flips to `completed` the next time it is read. */
  private async withAutoComplete(rows: LoopRow[], sessions: { loopId: string | null; nodeId: string | null; status: string }[]): Promise<LoopRow[]> {
    const out: LoopRow[] = [];
    for (const l of rows) {
      const p = progressOf(l.graph, sessions.filter((s) => s.loopId === l.id));
      if (l.status === "active" && p.total > 0 && p.completed === p.total) out.push((await this.loops.update(l.id, { status: "completed" })) ?? l);
      else out.push(l);
    }
    return out;
  }

  async listLoops(userId: string) {
    const rows = await this.loops.findAllByUser(userId);
    const sessions = await this.sessions.findAllByLoopIds(rows.map((l) => l.id));
    const fresh = await this.withAutoComplete(rows, sessions);
    const jds = await this.jdBriefs(fresh.map((l) => l.jdId));
    return { loops: fresh.map((l) => this.loopView(l, sessions, jds.get(l.jdId))) };
  }

  async getLoop(userId: string, id: string) {
    const l = await this.loops.findOwned(id, userId);
    if (!l) throw notFound("loop_not_found", "no loop with that id");
    const sessions = await this.sessions.findAllByLoopIds([l.id]);
    const [fresh] = await this.withAutoComplete([l], sessions);
    return this.loopView(fresh!, sessions, (await this.jdBriefs([l.jdId])).get(l.jdId));
  }

  /** active ⇄ paused, and active/paused → abandoned (which cancels the loop's upcoming interviews). */
  async setLoopStatus(userId: string, id: string, status: unknown) {
    const l = await this.loops.findOwned(id, userId);
    if (!l) throw notFound("loop_not_found", "no loop with that id");
    if (status !== "active" && status !== "paused" && status !== "abandoned") throw bad("invalid_loop", "status must be active, paused or abandoned");
    if (l.status === "completed" || l.status === "abandoned") throw conflict("loop_closed", "this loop is already finished");
    if (status === "abandoned") {
      for (const s of await this.sessions.findAllByLoopIds([l.id])) {
        if (["SCHEDULED", "PREP_READY", "PREP_FAILED"].includes(s.status)) {
          await this.sessions.transitionStatus(s.id, s.status as "SCHEDULED", "CANCELLED");
        }
      }
    }
    if (status === "active" && l.status !== "paused") return this.getLoop(userId, id);
    try {
      await this.loops.update(l.id, { status });
    } catch {
      // Resuming can collide with a newer live loop for the same JD (uq_loop_live).
      throw conflict("loop_exists", "You already have a live loop for this role");
    }
    return this.getLoop(userId, id);
  }

  // --- targets ------------------------------------------------------------------------------------

  async listTargets(userId: string) {
    const rows = await this.targets.findAllByUser(userId);
    const jds = await this.jdBriefs(rows.map((t) => t.jdId));
    const live = new Set((await this.loops.findAllByUser(userId)).filter((l) => l.status === "active" || l.status === "paused").map((l) => l.jdId));
    return { targets: rows.filter((t) => jds.has(t.jdId)).map((t) => ({ jd: jds.get(t.jdId)!, addedAt: t.createdAt, hasLiveLoop: live.has(t.jdId) })) };
  }

  async addTarget(userId: string, jdId: string): Promise<void> {
    const jd = await this.activeJd(jdId);
    if ((await this.targets.findAllByUser(userId)).length >= MAX_TARGETS_PER_USER) throw conflict("target_limit", `You can watch up to ${MAX_TARGETS_PER_USER} roles`);
    await this.targets.add(userId, jd.id);
  }

  async removeTarget(userId: string, jdId: string): Promise<void> {
    await this.targets.remove(userId, jdId);
  }

  /** Is this JD already targeted, and does the user have a live loop for it? (JD page header.) */
  async jdStatus(userId: string, jdId: string) {
    const [targets, loops] = await Promise.all([this.targets.findAllByUser(userId), this.loops.findAllByUser(userId)]);
    const loop = loops.find((l) => l.jdId === jdId && (l.status === "active" || l.status === "paused"));
    return { targeted: targets.some((t) => t.jdId === jdId), loopId: loop?.id ?? null };
  }
}
