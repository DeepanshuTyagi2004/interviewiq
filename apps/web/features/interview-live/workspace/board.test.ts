import { describe, expect, it } from 'vitest'
import {
  INTERVIEWER_STROKE, SIDE_MARGIN, TOOLBAR_CLEARANCE, blockRect, drawOrigin, sceneOrigin, sceneVersion, selectionSummary,
  skeletonsFor, summarizeScene, viewportOrigin, type Rect, type SceneElement,
} from './board'

const SCENE = [
  { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 100, height: 50, version: 2 },
  { id: 't1', type: 'text', text: 'Client', containerId: 'r1', version: 1 },
  { id: 'r2', type: 'rectangle', x: 300, y: 0, width: 100, height: 50, version: 1, customData: { author: 'interviewer' } },
  { id: 't2', type: 'text', text: 'API', containerId: 'r2', version: 1 },
  { id: 'a1', type: 'arrow', startBinding: { elementId: 'r1' }, endBinding: { elementId: 'r2' }, version: 1 },
  { id: 'x', type: 'ellipse', isDeleted: true, version: 9 },
]

describe('summarizeScene', () => {
  it('names shapes by their labels and resolves arrow ends', () => {
    expect(summarizeScene(SCENE)).toBe('rectangle "Client"\nrectangle "API" (interviewer)\narrow Client → API')
  })

  it('says when the board is empty', () => {
    expect(summarizeScene([])).toBe('(empty whiteboard)')
  })

  it('summarizes only the selected shapes and their labels', () => {
    expect(selectionSummary(SCENE, { r1: true })).toBe('rectangle "Client"')
  })
})

describe('sceneVersion and sceneOrigin', () => {
  it('changes when live elements change and ignores deleted ones', () => {
    expect(sceneVersion(SCENE)).toBe(6 + 5)
  })

  it('places new drawings to the right of existing ones', () => {
    expect(sceneOrigin(SCENE)).toEqual({ x: 480, y: 0 })
  })

  it('starts on an empty board where the candidate can see it, not under the whiteboard toolbar', () => {
    expect(sceneOrigin([], { x: 10, y: 20 })).toEqual({ x: 10, y: 20 })
    expect(sceneOrigin([])).toEqual({ x: 0, y: 0 })                       // no view to go by: the scene origin, as before
  })
})

describe('viewportOrigin', () => {
  it('is the visible top-left corner, pushed in past the menu and the toolbar', () => {
    expect(viewportOrigin({})).toEqual({ x: SIDE_MARGIN, y: TOOLBAR_CLEARANCE })
    expect(viewportOrigin({ scrollX: 0, scrollY: 0, zoom: { value: 1 } })).toEqual({ x: SIDE_MARGIN, y: TOOLBAR_CLEARANCE })
  })

  it('follows a scrolled and zoomed board: the clearance is screen pixels, so it shrinks in scene units as you zoom in', () => {
    // scrollX/scrollY are the scene offset of the view, so the visible top-left is (-scrollX, -scrollY)
    expect(viewportOrigin({ scrollX: -200, scrollY: -100, zoom: { value: 2 } })).toEqual({ x: 200 + SIDE_MARGIN / 2, y: 100 + TOOLBAR_CLEARANCE / 2 })
  })
})

describe('skeletonsFor', () => {
  it('lays shapes out in a row in the interviewer colour and binds arrows by id', () => {
    const out = skeletonsFor(
      [
        { type: 'rectangle', id: 'n1', label: 'Client' },
        { type: 'ellipse', id: 'n2' },
        { type: 'arrow', id: 'e1', from: 'n1', to: 'n2', label: 'call' },
        { type: 'text', id: 't', label: 'note', x: 10, y: 200 },
      ],
      { x: 500, y: 20 },
    )
    expect(out[0]).toMatchObject({ type: 'rectangle', id: 'n1', x: 500, y: 20, strokeColor: INTERVIEWER_STROKE, label: { text: 'Client' } })
    expect(out[1]).toMatchObject({ type: 'ellipse', x: 740, y: 20 })
    expect(out[2]).toMatchObject({ type: 'arrow', start: { id: 'n1' }, end: { id: 'n2' }, label: { text: 'call' } })
    expect(out[3]).toMatchObject({ type: 'text', text: 'note', x: 510, y: 220 })
  })
})

describe('blockRect', () => {
  it('is the row of shapes the interviewer will draw, relative to where it is placed', () => {
    expect(blockRect([{ type: 'rectangle', id: 'a' }, { type: 'rectangle', id: 'b' }])).toEqual({ x: 0, y: 0, w: 180 + 60 + 180, h: 80 })
  })

  it('follows shapes the interviewer positions itself, and ignores arrows bound to shapes', () => {
    const rect = blockRect([
      { type: 'rectangle', id: 'a', x: -20, y: 10 }, { type: 'rectangle', id: 'b', x: 300, y: 200 },
      { type: 'arrow', id: 'ar', from: 'a', to: 'b' },
    ])
    expect(rect).toEqual({ x: -20, y: 10, w: 300 + 180 + 20, h: 200 + 80 - 10 })
  })

  it('leaves room under the row for an arrow that is bound to nothing', () => {
    expect(blockRect([{ type: 'rectangle', id: 'a' }, { type: 'arrow', id: 'ar' }]).h).toBeGreaterThan(80 + 60)
  })

  it('is empty for nothing to draw', () => {
    expect(blockRect([])).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  })
})

describe('drawOrigin', () => {
  const view = { scrollX: 0, scrollY: 0, zoom: { value: 1 }, width: 1000, height: 700 }
  const block: Rect = { x: 0, y: 0, w: 180, h: 80 }
  const shape = (id: string, x: number, y: number, width: number, height: number): SceneElement => ({ id, type: 'rectangle', x, y, width, height })
  const hits = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

  it('uses the top-left of the visible board when it is empty', () => {
    expect(drawOrigin([], block, view)).toEqual({ x: SIDE_MARGIN, y: TOOLBAR_CLEARANCE })
  })

  it('goes into the nearest empty space beside what the candidate drew, inside the view', () => {
    const origin = drawOrigin([shape('c', SIDE_MARGIN, TOOLBAR_CLEARANCE, 100, 50)], block, view)
    expect(origin).toEqual({ x: 192, y: TOOLBAR_CLEARANCE })
  })

  it('never lands on the candidate drawing, however it is scattered over the view', () => {
    const drawn = [
      shape('a', 32, 96, 300, 200), shape('b', 380, 96, 250, 120), shape('c', 700, 120, 150, 300),
      shape('d', 40, 340, 500, 160), shape('e', 600, 500, 300, 100),
    ]
    const o = drawOrigin(drawn, block, view)
    const placed = { x: o.x + block.x, y: o.y + block.y, w: block.w, h: block.h }
    expect(drawn.some((e) => hits(placed, { x: e.x!, y: e.y!, w: e.width!, h: e.height! }))).toBe(false)
    expect(placed.x).toBeGreaterThanOrEqual(32)
    expect(placed.x + placed.w).toBeLessThanOrEqual(1000 - 32)
    expect(placed.y).toBeGreaterThanOrEqual(TOOLBAR_CLEARANCE)
  })

  it('keeps clear of a line or arrow by its real extent, not just its start point', () => {
    // an arrow starting at (400, 300) whose points run up and to the left of it
    const arrow: SceneElement = { id: 'ar', type: 'arrow', x: 400, y: 300, width: 300, height: 200, points: [[0, 0], [-300, -200]] }
    const o = drawOrigin([arrow], block, view)
    const placed = { x: o.x, y: o.y, w: block.w, h: block.h }
    expect(hits(placed, { x: 100, y: 100, w: 300, h: 200 })).toBe(false)
  })

  it('goes beside everything when the view has no room left', () => {
    const full = shape('wall', 0, 0, 2000, 2000)
    expect(drawOrigin([full], block, view)).toEqual({ x: 2000 + 80, y: 0 })
  })

  it('goes beside everything when the canvas size is not known', () => {
    expect(drawOrigin([shape('c', 0, 0, 100, 50)], block, { scrollX: 0, scrollY: 0 })).toEqual({ x: 180, y: 0 })
  })

  it('follows a scrolled and zoomed board', () => {
    const scrolled = { scrollX: -500, scrollY: -300, zoom: { value: 2 }, width: 1000, height: 700 }
    expect(drawOrigin([], block, scrolled)).toEqual({ x: 500 + SIDE_MARGIN / 2, y: 300 + TOOLBAR_CLEARANCE / 2 })
  })
})
