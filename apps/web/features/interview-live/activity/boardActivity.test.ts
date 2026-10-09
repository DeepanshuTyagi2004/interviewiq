import { describe, expect, it } from 'vitest'
import type { SceneElement } from '../workspace/board'
import { createHitTester, hitTest, shapeEvents } from './boardActivity'

const box = (id: string, x: number, y: number, extra: Partial<SceneElement> = {}): SceneElement => ({ id, type: 'rectangle', x, y, width: 100, height: 50, version: 1, ...extra })
const label = (id: string, containerId: string, text: string, version = 1): SceneElement => ({ id, type: 'text', text, containerId, version })

describe('hitTest', () => {
  it('names the topmost shape under the point by its label, falling back to its type and id', () => {
    const scene = [box('aaaa1111', 0, 0), label('t1', 'aaaa1111', 'cache'), box('bbbb2222', 50, 0)]
    expect(hitTest(scene, 60, 10)).toBe('rectangle bbbb')            // the later shape is on top
    expect(hitTest(scene, 10, 10)).toBe('cache')
  })
  it('allows a few pixels of slack and is undefined over empty canvas', () => {
    expect(hitTest([box('a', 0, 0)], 104, 54)).toBeDefined()
    expect(hitTest([box('a', 0, 0)], 300, 300)).toBeUndefined()
  })
  it('ignores deleted shapes and bound label text', () => {
    expect(hitTest([box('a', 0, 0, { isDeleted: true })], 10, 10)).toBeUndefined()
    expect(hitTest([{ ...label('t', 'a', 'x'), x: 0, y: 0, width: 50, height: 20 }], 10, 10)).toBeUndefined()
  })
  it('hits a line by the box around its points, not only its start', () => {
    const arrow: SceneElement = { id: 'ar', type: 'arrow', x: 200, y: 200, width: 100, height: 100, points: [[0, 0], [-100, -100]], version: 1 }
    expect(hitTest([arrow], 150, 150)).toBe('arrow ar')
  })
  it('names a free text element by its text', () => {
    expect(hitTest([{ id: 'tx', type: 'text', text: 'O(n)', x: 0, y: 0, width: 40, height: 20 }], 5, 5)).toBe('O(n)')
  })
})

describe('shapeEvents', () => {
  it('reports nothing the first time (the baseline) and an index to compare against next', () => {
    const { events, next } = shapeEvents(null, [box('a', 0, 0)])
    expect(events).toEqual([])
    expect(next.a).toMatchObject({ version: 1, x: 0, y: 0, deleted: false })
  })

  it('reports an added, moved, relabelled and deleted shape', () => {
    let { next } = shapeEvents(null, [])
    let out = shapeEvents(next, [box('a', 0, 0)])
    expect(out.events).toEqual([{ k: 'shape', op: 'add', id: 'a', kind: 'rectangle' }])
    out = shapeEvents(out.next, [box('a', 40, 0, { version: 2 })])
    expect(out.events).toEqual([{ k: 'shape', op: 'move', id: 'a', kind: 'rectangle' }])
    out = shapeEvents(out.next, [box('a', 40, 0, { version: 2 }), label('t', 'a', 'cache')])
    expect(out.events).toEqual([{ k: 'shape', op: 'edit', id: 'a', kind: 'rectangle', label: 'cache' }])
    out = shapeEvents(out.next, [box('a', 40, 0, { version: 3, isDeleted: true }), label('t', 'a', 'cache')])
    expect(out.events).toEqual([{ k: 'shape', op: 'delete', id: 'a', kind: 'rectangle', label: 'cache' }])
    next = out.next
    expect(shapeEvents(next, [box('a', 40, 0, { version: 3, isDeleted: true }), label('t', 'a', 'cache')]).events).toEqual([])
  })

  it('never reports the interviewer’s own shapes, or its labels', () => {
    const mine: SceneElement = box('i1', 0, 0, { customData: { author: 'interviewer' } })
    const { next } = shapeEvents(null, [])
    expect(shapeEvents(next, [mine, label('t', 'i1', 'input s')]).events).toEqual([])
  })

  it('treats a restored board as a new baseline, not as drawing (the caller resets prev to null)', () => {
    expect(shapeEvents(null, [box('a', 0, 0), box('b', 200, 0), box('c', 400, 0)]).events).toEqual([])
  })

  it('caps a long label', () => {
    const { next } = shapeEvents(null, [])
    const out = shapeEvents(next, [box('a', 0, 0), label('t', 'a', 'L'.repeat(100))])
    expect(out.events[0]).toMatchObject({ label: 'L'.repeat(60) })
  })
})

describe('createHitTester', () => {
  it('names the shape the pointer is on, not a long arrow whose bounding box merely covers it', () => {
    const arrow: SceneElement = { id: 'ar', type: 'arrow', x: 0, y: 0, width: 400, height: 400, points: [[0, 0], [400, 400]], version: 1 }
    const rect = box('bbbb2222', 300, 50)                 // inside the arrow's bounding box, far from its line
    const hit = createHitTester()
    expect(hit([arrow, rect], 320, 70)).toBe('rectangle bbbb')
    expect(hit([rect, arrow], 200, 200)).toBe('arrow ar')   // on the line itself
    expect(hit([arrow], 300, 100)).toBeUndefined()           // inside the box, nowhere near the line
  })

  it('reuses its index while the scene array is the same and rebuilds it when the scene changes', () => {
    let reads = 0
    const counted: SceneElement = { id: 'c', type: 'rectangle', x: 0, y: 0, height: 50, version: 1, get width() { reads++; return 100 } }
    const hit = createHitTester()
    const scene = [counted]
    expect(hit(scene, 10, 10)).toBe('rectangle c')
    const afterFirst = reads
    for (let i = 0; i < 50; i++) hit(scene, 10 + i, 10)       // fifty pointer moves over an unchanged scene
    expect(reads).toBe(afterFirst)
    hit([counted], 10, 10)                                      // a new array: the scene changed
    expect(reads).toBeGreaterThan(afterFirst)
  })

  it('agrees with hitTest on the plain cases', () => {
    const scene = [box('aaaa1111', 0, 0), label('t1', 'aaaa1111', 'cache')]
    expect(createHitTester()(scene, 10, 10)).toBe(hitTest(scene, 10, 10))
  })
})

describe('emoji in a shape label', () => {
  it('is capped by characters, never through an emoji', () => {
    const { next } = shapeEvents(null, [])
    const out = shapeEvents(next, [box('a', 0, 0), label('t', 'a', `${'L'.repeat(59)}😀😀`)])
    const text = out.events[0].k === 'shape' ? out.events[0].label ?? '' : ''
    expect(text).toBe(`${'L'.repeat(59)}😀`)
  })
})
