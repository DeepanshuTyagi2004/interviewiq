import type { RoundType } from "@/features/interview";
import { ROUND_OPTIONS } from "@/lib/constants/interview";
import type { InfoNode, ProcessGraph, ProcessNode, RoundNode } from "./types";

export const MAX_ROUND_NODES = 12;
export const MAX_INFO_NODES = 12;

/** The runnable round presets the editor palette offers, with sensible starting values. */
export const ROUND_PRESETS: { type: RoundType; label: string; durationMinutes: number; difficulty: RoundNode["difficulty"]; topics: string[] }[] = [
  { type: "dsa", durationMinutes: 60, difficulty: "medium", topics: ["Arrays", "Trees", "Dynamic programming"] },
  { type: "system-design", durationMinutes: 60, difficulty: "hard", topics: ["Scalability", "Storage", "Trade-offs"] },
  { type: "lld", durationMinutes: 60, difficulty: "medium", topics: ["Object-oriented design", "Extensibility"] },
  { type: "behavioural", durationMinutes: 45, difficulty: "medium", topics: ["Ownership", "Collaboration"] },
  { type: "hiring-manager", durationMinutes: 45, difficulty: "medium", topics: ["Project deep-dive", "Team fit"] },
].map((p) => ({ ...p, type: p.type as RoundType, difficulty: p.difficulty as RoundNode["difficulty"], label: ROUND_OPTIONS.find((o) => o.value === p.type)!.label }));

export const roundTypeLabel = (t: string) => ROUND_OPTIONS.find((o) => o.value === t)?.label ?? t;

let counter = 0;
const uid = () => `n${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function newRoundNode(type: RoundType, position: { x: number; y: number }): RoundNode {
  const p = ROUND_PRESETS.find((r) => r.type === type)!;
  return { id: uid(), kind: "round", type, name: p.label, durationMinutes: p.durationMinutes, difficulty: p.difficulty, topics: [...p.topics], position };
}

export function newInfoNode(position: { x: number; y: number }): InfoNode {
  return { id: uid(), kind: "info", name: "Info step", note: "", position };
}

export const roundNodesOf = (g: ProcessGraph): RoundNode[] => g.nodes.filter((n): n is RoundNode => n.kind === "round");

/**
 * Human-readable problems with a graph, mirroring the server's checks (the server is the authority;
 * this lets the editor explain why Save is disabled). Empty array = valid.
 */
export function graphProblems(g: ProcessGraph): string[] {
  const out: string[] = [];
  const rounds = roundNodesOf(g);
  const ids = rounds.map((r) => r.id);
  if (rounds.length === 0) out.push("Add at least one interview round.");
  if (rounds.length > MAX_ROUND_NODES) out.push(`A process can have at most ${MAX_ROUND_NODES} interview rounds.`);
  if (g.nodes.filter((n) => n.kind === "info").length > MAX_INFO_NODES) out.push(`At most ${MAX_INFO_NODES} info steps.`);
  if (rounds.some((r) => r.name.trim() === "")) out.push("Every round needs a name.");

  const indeg = new Map(ids.map((i) => [i, 0]));
  for (const e of g.edges) indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  const queue = ids.filter((i) => indeg.get(i) === 0);
  let visited = 0;
  while (queue.length) {
    const n = queue.pop()!;
    visited++;
    for (const e of g.edges) if (e.source === n) {
      const d = (indeg.get(e.target) ?? 0) - 1;
      indeg.set(e.target, d);
      if (d === 0) queue.push(e.target);
    }
  }
  if (visited !== ids.length) out.push("Rounds cannot form a loop. Each round must come before the next.");

  if (ids.length > 1) {
    const adj = new Map(ids.map((i) => [i, [] as string[]]));
    for (const e of g.edges) { adj.get(e.source)?.push(e.target); adj.get(e.target)?.push(e.source); }
    const seen = new Set([ids[0]!]);
    const stack = [ids[0]!];
    while (stack.length) for (const m of adj.get(stack.pop()!) ?? []) if (!seen.has(m)) { seen.add(m); stack.push(m); }
    if (seen.size !== ids.length) out.push("Every round must be connected to the rest of the process.");
  }
  return out;
}

/** Would adding source→target create a cycle? Used to refuse the connection as it is drawn. */
export function wouldCreateCycle(g: ProcessGraph, source: string, target: string): boolean {
  if (source === target) return true;
  const stack = [target];
  const seen = new Set<string>();
  while (stack.length) {
    const n = stack.pop()!;
    if (n === source) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const e of g.edges) if (e.source === n) stack.push(e.target);
  }
  return false;
}

export const isRound = (n: ProcessNode): n is RoundNode => n.kind === "round";
