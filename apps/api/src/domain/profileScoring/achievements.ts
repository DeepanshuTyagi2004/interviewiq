import { cleanText, number, object } from "./sanitization.js";

/** Small extensible taxonomy. Recognition alone awards no event-name points. */
export const ACHIEVEMENT_REGISTRY = Object.freeze({
  gsoc: { kind: "oss_program", aliases: ["google summer of code", "gsoc"] },
  outreachy: { kind: "oss_program", aliases: ["outreachy"] },
  icpc: { kind: "competition", aliases: ["icpc", "international collegiate programming contest"] },
  hackathon: { kind: "competition", aliases: ["hackathon"] },
});
export interface NormalizedAchievement {
  kind: "competition" | "oss_program"; event: string; outcome: "participant" | "finalist" | "winner" | "completed";
  rank: number | null; participants: number | null; year: number | null; scope: "local" | "national" | "international" | null;
  verification: "collector" | "self_reported";
}
/** Strings remain self-reported narrative, never converted into a win by substring matching. */
export function normalizeAchievement(value: unknown, collector = false): NormalizedAchievement | null {
  const item = object(value);
  const event = cleanText(item.event ?? item.name);
  if (!event) return null;
  const entry = Object.entries(ACHIEVEMENT_REGISTRY).find(([id, spec]) => id === event.toLowerCase() || spec.aliases.includes(event.toLowerCase()));
  const kind = item.kind === "competition" || item.kind === "oss_program" ? item.kind : entry?.[1].kind;
  if (kind !== "competition" && kind !== "oss_program") return null;
  const outcome = item.outcome;
  if (outcome !== "participant" && outcome !== "finalist" && outcome !== "winner" && outcome !== "completed") return null;
  const rank = number(item.rank), participants = number(item.participants), year = number(item.year);
  if ((rank !== null && (!Number.isInteger(rank) || rank < 1))
    || (participants !== null && (!Number.isInteger(participants) || participants < 1))
    || (rank !== null && participants !== null && rank > participants)
    || (year !== null && (!Number.isInteger(year) || year < 1970 || year > 9999))) return null;
  return { kind, event: entry?.[0] ?? event, outcome, rank, participants, year,
    scope: item.scope === "local" || item.scope === "national" || item.scope === "international" ? item.scope : null,
    // Caller-provided "verified: true" is never trusted. Only supported collector provenance can verify.
    verification: collector ? "collector" : "self_reported" };
}
