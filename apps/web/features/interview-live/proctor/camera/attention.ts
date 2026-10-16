/**
 * "Looking at the screen": the head pose against the candidate's own baseline (taken in the first
 * seconds, since cameras sit above, below or beside screens), plus where the eyes look. Thresholds are
 * lenient on purpose; a glance is not a violation, and the monitor only flags a sustained look away.
 */
import type { Gaze, Pose } from './face'

export const ATTENTION = {
  /** Head turned sideways past this much of the face width from the baseline. */
  yaw: 0.17,
  /** Nose moved down (head bowed) or up past this much of the face height from the baseline. */
  pitchDown: 0.12,
  pitchUp: 0.1,
  /** Eye-direction blendshape scores past which the eyes are off the screen. */
  eyesSide: 0.55,
  eyesUp: 0.5,
  eyesDown: 0.7,
  /** Facing frames that make the baseline (about two seconds at the monitor's rate). */
  calibrationFrames: 10,
  /** Frames this far off-centre are never used for the baseline. */
  calibrationMaxYaw: 0.15,
} as const

export interface Attention {
  samples: Pose[]
  baseline: Pose | null
}

export const NEW_ATTENTION: Attention = { samples: [], baseline: null }

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Adds a frame to the baseline until it is set; a set baseline never moves. */
export function calibrate(a: Attention, pose: Pose, gaze: Gaze): Attention {
  if (a.baseline) return a
  if (Math.abs(pose.yaw) > ATTENTION.calibrationMaxYaw || gaze.side > ATTENTION.eyesSide) return a
  const samples = [...a.samples, pose]
  if (samples.length < ATTENTION.calibrationFrames) return { samples, baseline: null }
  return { samples: [], baseline: { yaw: median(samples.map((p) => p.yaw)), pitch: median(samples.map((p) => p.pitch)) } }
}

/** Null until there is a baseline: the monitor never flags a look away it cannot measure. */
export function lookingAway(pose: Pose, gaze: Gaze, baseline: Pose | null): boolean | null {
  if (!baseline) return null
  const dPitch = pose.pitch - baseline.pitch
  return (
    Math.abs(pose.yaw - baseline.yaw) > ATTENTION.yaw ||
    dPitch > ATTENTION.pitchDown ||
    -dPitch > ATTENTION.pitchUp ||
    gaze.side > ATTENTION.eyesSide ||
    gaze.up > ATTENTION.eyesUp ||
    gaze.down > ATTENTION.eyesDown
  )
}
