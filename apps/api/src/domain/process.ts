import { z } from "zod";
import { ApiError } from "../lib/errors.js";
import { ROUND_TYPES } from "./enums.js";

/**
 * An interview process as a graph. `round` nodes are runnable by the AI interviewer and take part
 * in ordering, progress and gating. `info` nodes (online tests, take-homes…) are display-only: they
 * never carry edges and never count toward totals.
 */

export const MAX_ROUND_NODES = 12;
export const MAX_INFO_NODES = 12;

/** Off until the product decides the numbers (see CLAUDE.md "Scoring formulas & thresholds"). */
export const PASS_THRESHOLD: number | null = null;
export const RETAKE_COOLDOWN_DAYS: number | null = null;

const text = (max: number) => z.string().trim().max(max);
const position = z.object({ x: z.number().finite().min(-100000).max(100000), y: z.number().finite().min(-100000).max(100000) }).strict();

const roundNode = z.object({
  id: text(64).min(1),
  kind: z.literal("round"),
  type: z.enum(ROUND_TYPES),
  name: text(120).min(1),
  durationMinutes: z.number().int().min(5).max(240),
  difficulty: z.enum(["easy", "medium", "hard"]),
  topics: z.array(text(80).min(1)).max(20),
  instructions: text(4000).optional(),
  position,
}).strict();

const infoNode = z.object({
  id: text(64).min(1),
  kind: z.literal("info"),
  name: text(120).min(1),
  note: text(1000),
  topics: z.array(text(80).min(1)).max(20).optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  instructions: text(4000).optional(),
  position,
}).strict();

const edge = z.object({ source: text(64).min(1), target: text(64).min(1) }).strict();

export const processGraphSchema = z.object({
  nodes: z.array(z.discriminatedUnion("kind", [roundNode, infoNode])).max(MAX_ROUND_NODES + MAX_INFO_NODES),
  edges: z.array(edge).max(MAX_ROUND_NODES * MAX_ROUND_NODES),
}).strict();

export type ProcessGraph = z.infer<typeof processGraphSchema>;
export type ProcessNode = ProcessGraph["nodes"][number];
export type RoundNode = z.infer<typeof roundNode>;

const invalid = (message: string): never => {
  throw new ApiError(400, "invalid_process", message);
};

/** Parse + validate an untrusted graph. Throws 400 `invalid_process` with a human message. */
export function parseProcessGraph(input: unknown): ProcessGraph {
  const parsed = processGraphSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    return invalid(`${issue.path.join(".") || "graph"}: ${issue.message}`);
  }
  const g = parsed.data;
  const ids = new Set<string>();
  for (const n of g.nodes) {
    if (ids.has(n.id)) invalid(`Duplicate node id "${n.id}"`);
    ids.add(n.id);
  }
  const rounds = g.nodes.filter((n) => n.kind === "round");
  const infos = g.nodes.filter((n) => n.kind === "info");
  if (rounds.length === 0) invalid("Add at least one interview round");
  if (rounds.length > MAX_ROUND_NODES) invalid(`A process can have at most ${MAX_ROUND_NODES} interview rounds`);
  if (infos.length > MAX_INFO_NODES) invalid(`A process can have at most ${MAX_INFO_NODES} info steps`);

  const kind = new Map(g.nodes.map((n) => [n.id, n.kind]));
  const seen = new Set<string>();
  for (const e of g.edges) {
    if (!kind.has(e.source) || !kind.has(e.target)) invalid("An edge points at a node that does not exist");
    if (kind.get(e.source) !== "round" || kind.get(e.target) !== "round") invalid("Info steps cannot be connected to rounds");
    if (e.source === e.target) invalid("A round cannot lead to itself");
    const k = `${e.source}>${e.target}`;
    if (seen.has(k)) invalid("Duplicate connection");
    seen.add(k);
  }
  if (hasCycle(rounds.map((n) => n.id), g.edges)) invalid("Rounds cannot form a loop; each round must come before the next");
  if (!isConnected(rounds.map((n) => n.id), g.edges)) invalid("Every round must be connected to the rest of the process");
  return g;
}

function hasCycle(ids: string[], edges: ProcessGraph["edges"]): boolean {
  const indeg = new Map(ids.map((i) => [i, 0]));
  for (const e of edges) indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  const queue = ids.filter((i) => indeg.get(i) === 0);
  let visited = 0;
  while (queue.length) {
    const n = queue.pop()!;
    visited++;
    for (const e of edges) if (e.source === n) {
      const d = (indeg.get(e.target) ?? 0) - 1;
      indeg.set(e.target, d);
      if (d === 0) queue.push(e.target);
    }
  }
  return visited !== ids.length;
}

function isConnected(ids: string[], edges: ProcessGraph["edges"]): boolean {
  if (ids.length <= 1) return true;
  const adj = new Map(ids.map((i) => [i, [] as string[]]));
  for (const e of edges) { adj.get(e.source)?.push(e.target); adj.get(e.target)?.push(e.source); }
  const seen = new Set<string>([ids[0]!]);
  const stack = [ids[0]!];
  while (stack.length) for (const m of adj.get(stack.pop()!) ?? []) if (!seen.has(m)) { seen.add(m); stack.push(m); }
  return seen.size === ids.length;
}

export function roundNodes(g: ProcessGraph): RoundNode[] {
  return g.nodes.filter((n): n is RoundNode => n.kind === "round");
}

export function predecessors(g: ProcessGraph, nodeId: string): string[] {
  return g.edges.filter((e) => e.target === nodeId).map((e) => e.source);
}

export type NodeState = "locked" | "available" | "booked" | "completed";

/** What a session contributes to a node. Cancelled and aborted sessions free the node again. */
export interface NodeSession { nodeId: string | null; status: string }
const ACTIVE = new Set(["SCHEDULED", "PREP_QUEUED", "PREP_READY", "PREP_FAILED", "LIVE_IN_PROGRESS"]);

/**
 * Per-round state for a loop. Order-only gating: a round is available once every round feeding
 * into it has a COMPLETED session in this loop. Pass thresholds/cooldowns are intentionally absent
 * (PASS_THRESHOLD / RETAKE_COOLDOWN_DAYS are null until the product decides them).
 */
export function nodeStates(g: ProcessGraph, sessions: NodeSession[]): Map<string, NodeState> {
  const done = new Set(sessions.filter((s) => s.status === "COMPLETED" && s.nodeId).map((s) => s.nodeId!));
  const booked = new Set(sessions.filter((s) => ACTIVE.has(s.status) && s.nodeId).map((s) => s.nodeId!));
  const out = new Map<string, NodeState>();
  for (const n of roundNodes(g)) {
    if (done.has(n.id)) out.set(n.id, "completed");
    else if (booked.has(n.id)) out.set(n.id, "booked");
    else out.set(n.id, predecessors(g, n.id).every((p) => done.has(p)) ? "available" : "locked");
  }
  return out;
}

export function progressOf(g: ProcessGraph, sessions: NodeSession[]) {
  const states = nodeStates(g, sessions);
  const total = states.size;
  const completed = [...states.values()].filter((s) => s === "completed").length;
  return { total, completed, nextNodeIds: [...states].filter(([, s]) => s === "available").map(([id]) => id) };
}

/** A linear graph from an ordered round list, laid out left to right. Non-interview rounds become info nodes. */
export function linearGraph(rounds: {
  id: string; name: string; type: string | null | undefined; kind?: string | null;
  durationMinutes: number | null | undefined; difficulty: string | null | undefined; topics: string[]; note?: string; instructions?: string;
}[]): ProcessGraph {
  const nodes: ProcessNode[] = [];
  const edges: ProcessGraph["edges"] = [];
  let prev: string | null = null;
  let col = 0;
  let infoRow = 0;
  const diff = (d: string | null | undefined): "easy" | "medium" | "hard" => (d === "easy" || d === "hard" ? d : "medium");
  for (const r of rounds) {
    const id = r.id.slice(0, 64);
    const runnable = r.kind !== "info" && (ROUND_TYPES as readonly string[]).includes(r.type ?? "");
    if (!runnable) {
      nodes.push({ id, kind: "info", name: r.name.slice(0, 120), note: (r.note ?? "").slice(0, 1000), topics: r.topics.slice(0, 20).map((t) => t.slice(0, 80)).filter(Boolean), difficulty: diff(r.difficulty), ...(r.instructions ? { instructions: r.instructions.slice(0, 4000) } : {}), position: { x: infoRow * 260, y: -170 } });
      infoRow++;
      continue;
    }
    nodes.push({
      id, kind: "round", type: r.type as RoundNode["type"], name: r.name.slice(0, 120),
      durationMinutes: Math.min(240, Math.max(5, Math.round(r.durationMinutes ?? 45))), difficulty: diff(r.difficulty),
      topics: r.topics.slice(0, 20).map((t) => t.slice(0, 80)).filter(Boolean), position: { x: col * 280, y: 0 },
      ...(r.instructions ? { instructions: r.instructions.slice(0, 4000) } : {}),
    });
    if (prev) edges.push({ source: prev, target: id });
    prev = id;
    col++;
  }
  return { nodes, edges };
}
