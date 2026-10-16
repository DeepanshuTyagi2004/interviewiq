/**
 * Pure geometry on MediaPipe face-mesh landmarks (478 points, normalized to the frame): where the head
 * points, where the eyes look, and the five points that align a face crop for the identity model.
 * Nothing here touches the camera or a model, so it is all unit tested.
 */

export interface Point {
  x: number
  y: number
}

/** A blendshape score by name, 0..1 (MediaPipe's `faceBlendshapes[i].categories`). */
export type Blendshapes = Record<string, number>

export interface Pose {
  /** Nose offset across the face, -0.5..0.5; 0 is facing the camera. */
  yaw: number
  /** Nose height between forehead and chin, 0..1; only meaningful against the candidate's own baseline. */
  pitch: number
}

export interface Gaze {
  /** How far the eyes look to one side, 0..1. */
  side: number
  up: number
  down: number
}

// Face-mesh indices. "Left" and "right" are as seen in the (unmirrored) frame.
const NOSE_TIP = 1
const FACE_LEFT = 234
const FACE_RIGHT = 454
const FOREHEAD = 10
const CHIN = 152
const EYE_LEFT = [33, 133] as const
const EYE_RIGHT = [362, 263] as const
const MOUTH_LEFT = 61
const MOUTH_RIGHT = 291

function px(p: Point, w: number, h: number): Point {
  return { x: p.x * w, y: p.y * h }
}

function mid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

export function headPose(landmarks: Point[], w: number, h: number): Pose {
  const nose = px(landmarks[NOSE_TIP], w, h)
  const left = px(landmarks[FACE_LEFT], w, h)
  const right = px(landmarks[FACE_RIGHT], w, h)
  const top = px(landmarks[FOREHEAD], w, h)
  const chin = px(landmarks[CHIN], w, h)
  const width = right.x - left.x
  const height = chin.y - top.y
  return {
    yaw: width > 0 ? (nose.x - left.x) / width - 0.5 : 0,
    pitch: height > 0 ? (nose.y - top.y) / height : 0.5,
  }
}

export function eyeGaze(b: Blendshapes): Gaze {
  const v = (name: string) => b[name] ?? 0
  // Looking to one side turns one eye in and the other out.
  const toLeft = (v('eyeLookOutLeft') + v('eyeLookInRight')) / 2
  const toRight = (v('eyeLookInLeft') + v('eyeLookOutRight')) / 2
  return {
    side: Math.max(toLeft, toRight),
    up: (v('eyeLookUpLeft') + v('eyeLookUpRight')) / 2,
    down: (v('eyeLookDownLeft') + v('eyeLookDownRight')) / 2,
  }
}

/** Two eye centres, nose tip and two mouth corners, in pixels: the order of ARCFACE_TEMPLATE. */
export function alignmentPoints(landmarks: Point[], w: number, h: number): Point[] {
  const p = (i: number) => px(landmarks[i], w, h)
  return [
    mid(p(EYE_LEFT[0]), p(EYE_LEFT[1])),
    mid(p(EYE_RIGHT[0]), p(EYE_RIGHT[1])),
    p(NOSE_TIP),
    p(MOUTH_LEFT),
    p(MOUTH_RIGHT),
  ]
}

/** Where those five points sit in the 112x112 crop the identity model was trained on. */
export const ARCFACE_TEMPLATE: Point[] = [
  { x: 38.2946, y: 51.6963 },
  { x: 73.5318, y: 51.5014 },
  { x: 56.0252, y: 71.7366 },
  { x: 41.5493, y: 92.3655 },
  { x: 70.7299, y: 92.2041 },
]

/** The least-squares similarity transform (rotation, uniform scale, shift) taking `src` onto `dst`, as
 * canvas `setTransform(a, b, c, d, e, f)` arguments. */
export function similarityTransform(src: Point[], dst: Point[]): [number, number, number, number, number, number] {
  const n = src.length
  const ms = { x: src.reduce((s, p) => s + p.x, 0) / n, y: src.reduce((s, p) => s + p.y, 0) / n }
  const md = { x: dst.reduce((s, p) => s + p.x, 0) / n, y: dst.reduce((s, p) => s + p.y, 0) / n }
  let dot = 0
  let cross = 0
  let norm = 0
  for (let i = 0; i < n; i++) {
    const sx = src[i].x - ms.x
    const sy = src[i].y - ms.y
    const dx = dst[i].x - md.x
    const dy = dst[i].y - md.y
    dot += sx * dx + sy * dy
    cross += sx * dy - sy * dx
    norm += sx * sx + sy * sy
  }
  const a = norm > 0 ? dot / norm : 1
  const b = norm > 0 ? cross / norm : 0
  return [a, b, -b, a, md.x - (a * ms.x - b * ms.y), md.y - (b * ms.x + a * ms.y)]
}

export function normalize(v: Float32Array): Float32Array {
  let s = 0
  for (const x of v) s += x * x
  const len = Math.sqrt(s) || 1
  return v.map((x) => x / len)
}

/** Cosine similarity of two vectors. */
export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0
}
