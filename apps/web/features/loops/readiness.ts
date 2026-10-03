import type { Loop } from "./types";

/** "2 of 4 rounds" across the unedited (official) tracks: the only ones that count. Null when there are none. */
export function readinessSummary(loops: Loop[]): { completed: number; total: number } | null {
  const official = loops.filter((l) => l.countsTowardReadiness && l.status !== "abandoned");
  if (official.length === 0) return null;
  return {
    completed: official.reduce((n, l) => n + l.progress.completed, 0),
    total: official.reduce((n, l) => n + l.progress.total, 0),
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
    return { text: jd ? `Active track · ${jd.companyName} · ${jd.title}` : "1 active track", active: true };
  }
  if (active.length > 1) return { text: `${active.length} active tracks`, active: true };
  const paused = loops.filter((l) => l.status === "paused").length;
  if (paused > 0) return { text: `${paused} paused ${paused === 1 ? "track" : "tracks"}`, active: false };
  return { text: targetRole ? `Target · ${targetRole}` : "No active track", active: false };
}
