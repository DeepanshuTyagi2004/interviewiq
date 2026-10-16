/**
 * The camera monitor: per-frame readings in, the tile's border state and the camera ledger out. Each
 * condition opens an episode when first seen; it becomes a flag (one ledger entry, a red border) only if
 * it lasts its SUSTAIN_MS, and the episode closes once the condition has been gone for CLEAR_MS, so a
 * flicker never counts twice. Before that the border is amber: the candidate sees it and can fix it.
 *
 * The camera ledger is the candidate's own record. It never reaches the interviewer, never counts toward
 * the proctoring end rule and never changes a result.
 */
import type { IdentityVerdict } from './identity'

export type CameraFlagKind = 'no_face' | 'multiple_faces' | 'looking_away' | 'face_changed'

/** `starting`: the models are loading or calibrating. `unavailable`: this browser can't run them, so nothing is checked. */
export type CameraStatus = 'starting' | 'ok' | 'warn' | 'violation' | 'unavailable'

export const SUSTAIN_MS: Record<CameraFlagKind, number> = {
  no_face: 3000,
  multiple_faces: 1500,
  looking_away: 5000,
  // The identity check already waits for repeated mismatches.
  face_changed: 0,
}
export const CLEAR_MS = 1500

/** Which condition names the border when several hold at once. */
const PRIORITY: CameraFlagKind[] = ['face_changed', 'multiple_faces', 'no_face', 'looking_away']

export interface CameraFrame {
  faces: number
  /** Null while there is no gaze baseline yet. */
  away: boolean | null
  identity: IdentityVerdict
}

interface Episode {
  since: number
  lastSeen: number
  flagged: boolean
}

export interface CameraFlag {
  kind: CameraFlagKind
  /** When the condition began, not when it crossed its threshold. */
  at: number
}

export interface Monitor {
  episodes: Partial<Record<CameraFlagKind, Episode>>
  flags: CameraFlag[]
}

export const NEW_MONITOR: Monitor = { episodes: {}, flags: [] }

export function conditions(f: CameraFrame): Set<CameraFlagKind> {
  const on = new Set<CameraFlagKind>()
  if (f.faces === 0) on.add('no_face')
  if (f.faces >= 2) on.add('multiple_faces')
  if (f.faces === 1 && f.away === true) on.add('looking_away')
  if (f.faces === 1 && f.identity === 'different') on.add('face_changed')
  return on
}

export function stepMonitor(m: Monitor, frame: CameraFrame, now: number): { monitor: Monitor; added: CameraFlag[] } {
  const on = conditions(frame)
  const episodes: Monitor['episodes'] = {}
  const added: CameraFlag[] = []
  for (const kind of PRIORITY) {
    const was = m.episodes[kind]
    if (on.has(kind)) {
      const ep: Episode = was ? { ...was, lastSeen: now } : { since: now, lastSeen: now, flagged: false }
      if (!ep.flagged && now - ep.since >= SUSTAIN_MS[kind]) {
        ep.flagged = true
        added.push({ kind, at: ep.since })
      }
      episodes[kind] = ep
    } else if (was && now - was.lastSeen < CLEAR_MS) {
      episodes[kind] = was
    }
  }
  return { monitor: { episodes, flags: added.length ? [...m.flags, ...added] : m.flags }, added }
}

/** The border: red while a flagged episode is open, amber while an unflagged one is, green otherwise. */
export function monitorStatus(m: Monitor): { status: 'ok' | 'warn' | 'violation'; reason: CameraFlagKind | null } {
  const open = PRIORITY.filter((k) => m.episodes[k])
  const flagged = open.find((k) => m.episodes[k]?.flagged)
  if (flagged) return { status: 'violation', reason: flagged }
  if (open.length) return { status: 'warn', reason: open[0] }
  return { status: 'ok', reason: null }
}

export const CAMERA_TEXT: Record<CameraFlagKind, string> = {
  no_face: "We can't see you. Stay in view of your camera.",
  multiple_faces: 'Someone else is in view. Only you should be on camera.',
  looking_away: 'Keep your eyes on the screen.',
  face_changed: 'The person on camera has changed. Only you should take this interview.',
}
