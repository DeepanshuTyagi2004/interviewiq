/**
 * Pure whiteboard helpers: the text summary the agent reads (spec §6.2 `board.summary`), and the
 * Excalidraw element skeletons for the interviewer's `board.draw`. No Excalidraw import, so this
 * stays testable without the browser-only library.
 */
import type { DrawElement } from '../protocol/messages'

export interface SceneElement {
  id: string
  type: string
  x?: number
  y?: number
  width?: number
  height?: number
  text?: string
  isDeleted?: boolean
  containerId?: string | null
  startBinding?: { elementId?: string } | null
  endBinding?: { elementId?: string } | null
  /** Lines, arrows and freehand strokes: points relative to (x, y), which can run up and to the left of it. */
  points?: readonly (readonly [number, number])[]
  customData?: Record<string, unknown>
  version?: number
}

export type Skeleton = Record<string, unknown>

/** The brand orange, hsl(16.3 100% 56.1%): interviewer marks on the whiteboard. */
export const INTERVIEWER_STROKE = '#ff5c1f'

const SHAPE_W = 180
const SHAPE_H = 80
const GAP = 60
const TEXT_H = 32
const ARROW_W = 100
const ARROW_H = 24
/** Space kept between the interviewer's drawing and anything of the candidate's. */
const CLEAR = 24
/** How far apart the candidate positions for a drawing are tried. */
const STEP = 40
const BOTTOM_MARGIN = 64

const live = (elements: readonly unknown[]) =>
  (elements as SceneElement[]).filter((e) => e && e.type && !e.isDeleted)

export function summarizeScene(elements: readonly unknown[]): string {
  const els = live(elements)
  if (!els.length) return '(empty whiteboard)'
  const labelOf = new Map<string, string>()
  for (const e of els) if (e.type === 'text' && e.containerId && e.text) labelOf.set(e.containerId, e.text)
  const name = (id?: string) => (id ? labelOf.get(id) ?? `#${id.slice(0, 6)}` : '?')
  const lines: string[] = []
  for (const e of els) {
    if (e.type === 'text') {
      if (!e.containerId && e.text) lines.push(`text "${e.text}"`)
      continue
    }
    const by = e.customData?.author === 'interviewer' ? ' (interviewer)' : ''
    if (e.type === 'arrow' || e.type === 'line') {
      lines.push(`${e.type} ${name(e.startBinding?.elementId)} → ${name(e.endBinding?.elementId)}${by}`)
    } else {
      const label = labelOf.get(e.id)
      lines.push(`${e.type}${label ? ` "${label}"` : ''}${by}`)
    }
  }
  return lines.join('\n')
}

/** The summary of just the shapes the candidate selected (with their bound labels), for Ask. */
export function selectionSummary(elements: readonly unknown[], selectedIds: Record<string, boolean>): string {
  const picked = live(elements).filter((e) => selectedIds[e.id] || (e.containerId && selectedIds[e.containerId]))
  return summarizeScene(picked)
}

/** Changes whenever a live element changes; used to skip unchanged backups. */
export function sceneVersion(elements: readonly unknown[]): number {
  const els = live(elements)
  return els.reduce((n, e) => n + (e.version ?? 0), 0) + els.length
}

/** Screen pixels kept clear at the top and left of the view for Excalidraw's own menu button and toolbar. */
export const TOOLBAR_CLEARANCE = 96
export const SIDE_MARGIN = 32

/** The visible top-left of the board, in scene units and pushed in past the menu and toolbar, so a shape drawn
 * "at the start" is seen and not hidden under them. Excalidraw's scrollX/scrollY are the scene offset of the view,
 * so the corner is (-scrollX, -scrollY); the clearance is in screen pixels, hence the zoom. */
export function viewportOrigin(appState: { scrollX?: number; scrollY?: number; zoom?: { value?: number } }): { x: number; y: number } {
  const zoom = appState.zoom?.value || 1
  return { x: -(appState.scrollX ?? 0) + SIDE_MARGIN / zoom, y: -(appState.scrollY ?? 0) + TOOLBAR_CLEARANCE / zoom }
}

/** Where new interviewer drawings go: to the right of everything already drawn, or on an empty board at `empty`
 * (the visible corner), falling back to the scene origin when there is no view to go by. */
export function sceneOrigin(elements: readonly unknown[], empty: { x: number; y: number } = { x: 0, y: 0 }): { x: number; y: number } {
  const els = live(elements).filter((e) => typeof e.x === 'number')
  if (!els.length) return empty
  const right = Math.max(...els.map((e) => (e.x ?? 0) + (e.width ?? 0)))
  const top = Math.min(...els.map((e) => e.y ?? 0))
  return { x: right + 80, y: top }
}

export interface Rect { x: number; y: number; w: number; h: number }

type ViewState = { scrollX?: number; scrollY?: number; zoom?: { value?: number }; width?: number; height?: number }

/** The rectangle the interviewer's elements will fill, relative to where the block is placed (see skeletonsFor).
 * Arrows bound to shapes follow those shapes and add nothing; one bound to nothing sits under the row. */
export function blockRect(elements: DrawElement[]): Rect {
  let col = 0
  let loose = false
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const e of elements) {
    if (e.type === 'arrow') {
      if (!e.from || !e.to) loose = true
      continue
    }
    const placed = e.x !== undefined && e.y !== undefined
    const x = placed ? (e.x as number) : col * (SHAPE_W + GAP)
    const y = placed ? (e.y as number) : 0
    if (!placed) col += 1
    const w = e.type === 'text' ? Math.min(400, Math.max(60, 9 * (e.label?.length ?? 0))) : SHAPE_W
    const h = e.type === 'text' ? TEXT_H : SHAPE_H
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h)
  }
  if (loose) {
    minX = Math.min(minX, 0); maxX = Math.max(maxX, ARROW_W)
    minY = Math.min(minY, SHAPE_H + GAP); maxY = Math.max(maxY, SHAPE_H + GAP + ARROW_H)
  }
  return minX === Infinity ? { x: 0, y: 0, w: 0, h: 0 } : { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/** The part of the board the candidate can use, in scene units: the view without the menu and toolbar at the top,
 * the zoom controls at the bottom, or a margin at the sides. Null when the canvas size is not known. */
function visibleArea(view: ViewState): { left: number; top: number; right: number; bottom: number } | null {
  if (!view.width || !view.height) return null
  const zoom = view.zoom?.value || 1
  const { x: left, y: top } = viewportOrigin(view)
  return { left, top, right: -(view.scrollX ?? 0) + (view.width - SIDE_MARGIN) / zoom, bottom: -(view.scrollY ?? 0) + (view.height - BOTTOM_MARGIN) / zoom }
}

/** Whether the block, placed at `origin`, is inside the visible board. True when the canvas size is not known. */
export function inVisibleArea(block: Rect, origin: { x: number; y: number }, view: ViewState): boolean {
  const area = visibleArea(view)
  if (!area) return true
  const x = origin.x + block.x
  const y = origin.y + block.y
  return x >= area.left && y >= area.top && x + block.w <= area.right && y + block.h <= area.bottom
}

/** What an element covers: its box, or for a line, arrow or stroke the box around its points. */
export function coverOf(e: SceneElement): Rect {
  const x = e.x ?? 0
  const y = e.y ?? 0
  if (e.points?.length) {
    const xs = e.points.map((p) => x + p[0])
    const ys = e.points.map((p) => y + p[1])
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
  }
  return { x, y, w: e.width ?? 0, h: e.height ?? 0 }
}

const touches = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

/** Where the interviewer's block goes: empty space inside the visible board, scanned from the top-left, keeping
 * `CLEAR` away from everything the candidate drew. If the view has no room (or its size is not known) it goes beside
 * everything instead, which is still empty. Never over the candidate's drawing. */
export function drawOrigin(existing: readonly unknown[], block: Rect, view: ViewState): { x: number; y: number } {
  const els = live(existing).filter((e) => typeof e.x === 'number')
  const area = visibleArea(view)
  if (area && block.w > 0 && block.h > 0) {
    const covers = els.map(coverOf)
    for (let y = area.top; y + block.h <= area.bottom; y += STEP) {
      for (let x = area.left; x + block.w <= area.right; x += STEP) {
        const probe = { x: x - CLEAR, y: y - CLEAR, w: block.w + 2 * CLEAR, h: block.h + 2 * CLEAR }
        if (!covers.some((c) => touches(probe, c))) return { x: x - block.x, y: y - block.y }
      }
    }
  }
  return sceneOrigin(els, viewportOrigin(view))
}

/** Excalidraw element skeletons for `board.draw`: shapes in a row from `origin` unless placed, in the
 * interviewer colour; arrows bind to shapes by id (convertToExcalidrawElements resolves them). */
export function skeletonsFor(elements: DrawElement[], origin: { x: number; y: number }): Skeleton[] {
  let col = 0
  const place = (e: DrawElement) => {
    if (e.x !== undefined && e.y !== undefined) return { x: origin.x + e.x, y: origin.y + e.y }
    const p = { x: origin.x + col * (SHAPE_W + GAP), y: origin.y }
    col += 1
    return p
  }
  return elements.map((e) => {
    const base = { id: e.id, strokeColor: INTERVIEWER_STROKE }
    if (e.type === 'arrow') {
      return {
        ...base, type: 'arrow', x: origin.x, y: origin.y + SHAPE_H + GAP,
        ...(e.from ? { start: { id: e.from } } : {}),
        ...(e.to ? { end: { id: e.to } } : {}),
        ...(e.label ? { label: { text: e.label } } : {}),
      }
    }
    const p = place(e)
    if (e.type === 'text') return { ...base, type: 'text', x: p.x, y: p.y, text: e.label ?? '' }
    return {
      ...base, type: e.type, x: p.x, y: p.y, width: SHAPE_W, height: SHAPE_H,
      ...(e.label ? { label: { text: e.label } } : {}),
    }
  })
}
