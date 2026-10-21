import { shortLevel } from "@/features/report/presentation";
import type { Loop, ReadinessLevel } from "./types";

const READINESS_ORDER: ReadinessLevel[] = ["getting_started", "progressing", "nearly_ready", "interview_ready"];
const READINESS_LABEL: Record<ReadinessLevel, string> = {
  getting_started: "Getting started",
  progressing: "Progressing",
  nearly_ready: "Nearly ready",
  interview_ready: "Interview-ready",
};

export function readinessLabel(level: ReadinessLevel): string {
  return READINESS_LABEL[level];
}

/**
 * The readiness line for one loop, mock-framed (never a badge or an endorsement):
 * "Readiness: Progressing · Meesho SDE1 mock process", or "Interview-ready · Meesho SDE1 mock process".
 * Null for loops that do not count toward readiness (edited or standalone).
 */
export function readinessLine(loop: Pick<Loop, "readiness" | "jd" | "name" | "level">): string | null {
  if (!loop.readiness) return null;
  const level = loop.jd?.level ?? loop.level;
  const subject = [loop.jd?.companyName, level ? shortLevel(level) : null, "mock process"].filter(Boolean).join(" ");
  const label = readinessLabel(loop.readiness);
  return loop.readiness === "interview_ready" ? `${label} · ${subject}` : `Readiness: ${label} · ${subject}`;
}

/** "2 of 4 rounds" across the unedited (official) tracks: the only ones that count. Null when there are none. */
export function readinessSummary(loops: Loop[]): { completed: number; total: number; label: string | null } | null {
  const official = loops.filter((l) => l.countsTowardReadiness && !l.jd?.practiceTemplate && l.status !== "abandoned");
  if (official.length === 0) return null;
  // The label is the furthest level reached across the unedited tracks (null if the API sent none).
  const best = official.reduce(
    (b, l) => (l.readiness && READINESS_ORDER.indexOf(l.readiness) > b ? READINESS_ORDER.indexOf(l.readiness) : b),
    -1,
  );
  return {
    completed: official.reduce((n, l) => n + l.progress.completed, 0),
    total: official.reduce((n, l) => n + l.progress.total, 0),
    label: best >= 0 ? READINESS_LABEL[READINESS_ORDER[best]!] : null,
  };
}

export interface TrackStatus {
  text: string;
  /** True only while at least one track is active: drives the status dot. */
  active: boolean;
}

/**
 * The one-line status under your name in the menus, from your real tracks. The onboarding target
 * role is only a target: it never reads as "active".
 */
export function trackStatus(loops: Loop[], targetRole?: string | null): TrackStatus {
  const active = loops.filter((l) => l.status === "active");
  if (active.length === 1) {
    const jd = active[0]!.jd;
    return { text: jd ? `Active track · ${jd.companyName} · ${jd.title}` : `Active track · ${active[0]!.name}`, active: true };
  }
  if (active.length > 1) return { text: `${active.length} active tracks`, active: true };
  const paused = loops.filter((l) => l.status === "paused").length;
  if (paused > 0) return { text: `${paused} paused ${paused === 1 ? "track" : "tracks"}`, active: false };
  return { text: targetRole ? `Target · ${targetRole}` : "No active track", active: false };
}
