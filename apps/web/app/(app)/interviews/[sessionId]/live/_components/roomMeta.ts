import type { InterviewSession } from "@/features/interview";
import { companyLabel, levelLabel, roundLabel } from "@/features/interview/presentation";

/** What the room shows about the session it's running (eyebrows, the live header). */
export interface RoomMeta {
  company: string;
  level: string;
  round: string;
}

export function roomMetaFrom(session: InterviewSession | undefined): RoomMeta | undefined {
  if (!session) return undefined;
  return { company: companyLabel(session), level: levelLabel(session.level), round: roundLabel(session.roundType) };
}

/** "MEESHO · SDE I · DSA", or a plain label until the session has loaded. */
export function roomEyebrow(meta: RoomMeta | undefined): string {
  return meta ? `${meta.company} · ${meta.level} · ${meta.round}` : "Interview room";
}

/** "04:07" (or "1:02:09" past an hour) for an elapsed duration in milliseconds. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mmss = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
}
