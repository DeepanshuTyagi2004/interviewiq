/**
 * Excalidraw → activity events (spec §5.1): the shape under the pointer, and what the candidate adds, moves,
 * relabels or deletes. Pure of the library. The interviewer's own shapes are never the candidate's activity, and
 * a restored board is a new baseline (the caller passes `prev = null`), not drawing.
 */
import type { ActivityEventBody } from '../protocol/messages'
import { coverOf, type SceneElement } from '../workspace/board'
import { capCodePoints } from './text'

const HIT_PAD = 6
const MAX_LABEL = 60

export type ShapeIndex = Record<string, { version: number; x: number; y: number; label: string; deleted: boolean }>

function labelsOf(elements: readonly SceneElement[]): Map<string, string> {
  const labels = new Map<string, string>()
  for (const e of elements) if (e.type === 'text' && e.containerId && e.text && !e.isDeleted) labels.set(e.containerId, e.text)
  return labels
}

const nameOf = (e: SceneElement, labels: Map<string, string>): string =>
  capCodePoints(labels.get(e.id) ?? (e.type === 'text' && e.text ? e.text : `${e.type} ${e.id.slice(0, 4)}`), MAX_LABEL)

interface Indexed {
  name: string
  kind: string
  rect: { x: number; y: number; w: number; h: number }
  /** A line, arrow or freehand stroke: hit along its path, not anywhere in its bounding box. */
  path: [number, number][] | null
}

const LINEAR = new Set(['line', 'arrow', 'freedraw'])

function distanceToSegment(px: number, py: number, a: readonly [number, number], b: readonly [number, number]): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len2))
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy))
}

function indexOf(elements: readonly SceneElement[]): Indexed[] {
  const labels = labelsOf(elements)
  const out: Indexed[] = []
  for (const e of elements) {
    if (e.isDeleted || e.containerId || typeof e.x !== 'number') continue
    const x = e.x
    const y = e.y ?? 0
    out.push({
      name: nameOf(e, labels),
      kind: e.type,
      rect: coverOf(e),
      path: LINEAR.has(e.type) && e.points && e.points.length > 1 ? e.points.map((p) => [x + p[0], y + p[1]]) : null,
    })
  }
  return out
}

function hits(s: Indexed, x: number, y: number): boolean {
  const r = s.rect
  if (x < r.x - HIT_PAD || x > r.x + r.w + HIT_PAD || y < r.y - HIT_PAD || y > r.y + r.h + HIT_PAD) return false
  if (!s.path) return true
  return s.path.some((p, i) => i > 0 && distanceToSegment(x, y, s.path![i - 1], p) <= HIT_PAD)
}

/** A hit tester for one board. Pointer moves arrive many times a second over a scene that rarely changes, so it
 * keeps its index of the scene until the elements array, or any element's version, changes. A long arrow across the
 * canvas is hit along its line, so it does not shadow the shapes under its bounding box. The result is the label (or
 * type and id) of the topmost shape under a scene point, or undefined over empty canvas. */
export function createHitTester() {
  let elements: readonly SceneElement[] | null = null
  let fingerprint = 0
  let index: Indexed[] = []
  return (scene: readonly SceneElement[], x: number, y: number): string | undefined => {
    let print = scene.length
    for (const e of scene) print += (e.version ?? 0) + (e.isDeleted ? 1 : 0)
    if (scene !== elements || print !== fingerprint) {
      elements = scene
      fingerprint = print
      index = indexOf(scene)
    }
    for (let i = index.length - 1; i >= 0; i--) if (hits(index[i], x, y)) return index[i].name
    return undefined
  }
}

export const hitTest = (elements: readonly SceneElement[], x: number, y: number): string | undefined => createHitTester()(elements, x, y)

export function shapeEvents(prev: ShapeIndex | null, elements: readonly SceneElement[]): { events: ActivityEventBody[]; next: ShapeIndex } {
  const labels = labelsOf(elements)
  const next: ShapeIndex = {}
  const events: ActivityEventBody[] = []
  for (const e of elements) {
    if (e.customData?.author === 'interviewer' || e.containerId) continue
    const label = labels.get(e.id) ?? (e.type === 'text' ? e.text ?? '' : '')
    const now = { version: e.version ?? 0, x: e.x ?? 0, y: e.y ?? 0, label, deleted: !!e.isDeleted }
    next[e.id] = now
    if (!prev) continue
    const was = prev[e.id]
    const body = (op: 'add' | 'move' | 'edit' | 'delete'): ActivityEventBody => ({
      k: 'shape', op, id: e.id, kind: e.type, ...(label ? { label: capCodePoints(label, MAX_LABEL) } : {}),
    })
    if (!was) {
      if (!now.deleted) events.push(body('add'))
    } else if (now.deleted && !was.deleted) events.push(body('delete'))
    else if (!now.deleted && (now.x !== was.x || now.y !== was.y)) events.push(body('move'))
    else if (!now.deleted && (now.version !== was.version || now.label !== was.label)) events.push(body('edit'))
  }
  return { events, next }
}
