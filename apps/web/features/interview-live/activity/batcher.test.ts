import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityEventBody } from '../protocol/messages'
import { ActivityBatcher, FLUSH_MS, MAX_BATCH_BYTES, trimBatch, type BatchOut } from './batcher'

let sent: BatchOut[]
let batcher: ActivityBatcher

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
  sent = []
  batcher = new ActivityBatcher({ now: () => Date.now(), send: (b) => sent.push(b) })
})
afterEach(() => {
  batcher.stop()
  vi.useRealTimers()
})

const code = (line: number): ActivityEventBody => ({ k: 'ptr', s: 'code', line, col: 1, text: `line ${line}` })
const edit = (line: number, ins: string): ActivityEventBody => ({ k: 'edit', from_line: line, to_line: line, ins, removed: 0 })
const lines = (b: BatchOut) => b.events.filter((e) => e.k === 'ptr').map((e) => (e.k === 'ptr' && e.s === 'code' ? e.line : -1))

describe('ActivityBatcher', () => {
  it('stamps each event and sends one batch when the flush timer fires', () => {
    batcher.record({ k: 'focus', s: 'code' })
    vi.advanceTimersByTime(200)
    batcher.record({ k: 'caret', line: 2, col: 3 })
    expect(sent).toHaveLength(0)
    vi.advanceTimersByTime(FLUSH_MS)
    expect(sent).toHaveLength(1)
    expect(sent[0].sent_at).toBe(1_000_000 + FLUSH_MS)
    expect(sent[0].events).toEqual([{ k: 'focus', s: 'code', t: 1_000_000 }, { k: 'caret', line: 2, col: 3, t: 1_000_200 }])
  })

  it('sends nothing when nothing happened', () => {
    vi.advanceTimersByTime(5000)
    batcher.flush()
    expect(sent).toHaveLength(0)
  })

  it('drops a pointer sample on the target it already reported', () => {
    batcher.record(code(4))
    vi.advanceTimersByTime(300)
    batcher.record(code(4))
    vi.advanceTimersByTime(FLUSH_MS)
    expect(sent.flatMap(lines)).toEqual([4])
  })

  it('limits pointer changes to one per 250 ms and still reports where it ended up', () => {
    batcher.record(code(1))
    vi.advanceTimersByTime(100)
    batcher.record(code(2))
    vi.advanceTimersByTime(100)
    batcher.record(code(3))
    vi.advanceTimersByTime(FLUSH_MS)
    expect(sent.flatMap(lines)).toEqual([1, 3])
  })

  it('reports a return to a line it left through another surface', () => {
    batcher.record(code(5))
    vi.advanceTimersByTime(300)
    batcher.record({ k: 'ptr', s: 'panel', quote: 'the statement' })
    vi.advanceTimersByTime(300)
    batcher.record(code(5))
    vi.advanceTimersByTime(FLUSH_MS)
    const kinds = sent.flatMap((b) => b.events).map((e) => (e.k === 'ptr' ? e.s : e.k))
    expect(kinds).toEqual(['code', 'panel', 'code'])
  })

  it('survives a flood: 1000 pointer moves in a second send a few events and the final target', () => {
    for (let i = 0; i < 1000; i++) {
      batcher.record(code((i % 50) + 1))
      vi.advanceTimersByTime(1)
    }
    vi.advanceTimersByTime(FLUSH_MS)
    const events = sent.flatMap((b) => b.events)
    expect(sent.length).toBeLessThanOrEqual(3)
    expect(events.length).toBeLessThanOrEqual(10)
    expect(lines({ sent_at: 0, events }).at(-1)).toBe((999 % 50) + 1)
    for (const b of sent) expect(JSON.stringify(b.events).length).toBeLessThanOrEqual(MAX_BATCH_BYTES)
  })

  it('merges quick edits on one line, keeps a new line separate and caps what was inserted', () => {
    batcher.record(edit(1, 'a'))
    vi.advanceTimersByTime(100)
    batcher.record(edit(1, 'b'))
    vi.advanceTimersByTime(100)
    batcher.record(edit(2, 'c'))
    vi.advanceTimersByTime(400)
    batcher.record(edit(2, 'd'))
    vi.advanceTimersByTime(FLUSH_MS)
    const edits = sent.flatMap((b) => b.events).filter((e) => e.k === 'edit')
    expect(edits.map((e) => (e.k === 'edit' ? [e.from_line, e.ins] : []))).toEqual([[1, 'ab'], [2, 'c'], [2, 'd']])
    batcher.record(edit(9, 'x'.repeat(150)))
    batcher.record(edit(9, 'y'.repeat(150)))
    batcher.flush()
    const merged = sent.at(-1)!.events[0]
    expect(merged.k === 'edit' && merged.ins.length).toBe(200)
  })

  it('merges typing even though the editor reports a caret move after every keystroke', () => {
    const caret = (col: number): ActivityEventBody => ({ k: 'caret', line: 1, col })
    batcher.record(edit(1, 'a'))
    batcher.record(caret(2))
    vi.advanceTimersByTime(60)
    batcher.record(edit(1, 'b'))
    batcher.record(caret(3))
    vi.advanceTimersByTime(60)
    batcher.record(edit(1, 'c'))
    batcher.record(caret(4))
    vi.advanceTimersByTime(FLUSH_MS)
    const events = sent.flatMap((b) => b.events)
    expect(events.filter((e) => e.k === 'edit').map((e) => (e.k === 'edit' ? e.ins : ''))).toEqual(['abc'])
    expect(events.filter((e) => e.k === 'caret')).toEqual([expect.objectContaining({ line: 1, col: 4 })])   // only where it ended up
  })

  it('survives a caret flood (a drag-select): one caret per flush, the last one, with its selection', () => {
    for (let i = 0; i < 1000; i++) {
      batcher.record({ k: 'caret', line: 1, col: (i % 50) + 1, sel: [1, 2], text: 'selected text' })
      vi.advanceTimersByTime(1)
    }
    vi.advanceTimersByTime(FLUSH_MS)
    const carets = sent.flatMap((b) => b.events).filter((e) => e.k === 'caret')
    expect(carets.length).toBeLessThanOrEqual(3)
    expect(carets.at(-1)).toMatchObject({ col: (999 % 50) + 1, sel: [1, 2], text: 'selected text' })
  })

  it('does not repeat a caret that has not moved', () => {
    batcher.record({ k: 'caret', line: 2, col: 3 })
    vi.advanceTimersByTime(FLUSH_MS)
    batcher.record({ k: 'caret', line: 2, col: 3 })
    vi.advanceTimersByTime(FLUSH_MS)
    expect(sent.flatMap((b) => b.events).filter((e) => e.k === 'caret')).toHaveLength(1)
  })

  it('reports a shape at once at most every half second per element and operation, and sends the rest at the flush', () => {
    const shape = (op: 'edit' | 'move'): ActivityEventBody => ({ k: 'shape', op, id: 'a', kind: 'rectangle', label: 'cache' })
    batcher.record(shape('move'))
    vi.advanceTimersByTime(100)
    batcher.record(shape('move'))   // too soon after the first: held for the flush
    batcher.record(shape('edit'))   // another operation: not held
    batcher.flush()
    expect(sent.flatMap((b) => b.events).map((e) => (e.k === 'shape' ? e.op : e.k))).toEqual(['move', 'edit', 'move'])
    vi.advanceTimersByTime(600)
    batcher.record(shape('move'))
    batcher.flush()
    expect(sent.at(-1)!.events).toHaveLength(1)
  })

  it('keeps the latest of a quickly repeated shape change, so a label typed fast is not left partial', () => {
    const edited = (label: string): ActivityEventBody => ({ k: 'shape', op: 'edit', id: 'a', kind: 'text', label })
    batcher.record(edited('c'))
    vi.advanceTimersByTime(100)
    batcher.record(edited('cac'))
    vi.advanceTimersByTime(100)
    batcher.record(edited('cache'))
    vi.advanceTimersByTime(FLUSH_MS)
    expect(sent.flatMap((b) => b.events).map((e) => (e.k === 'shape' ? e.label : e.k))).toEqual(['c', 'cache'])
  })

  it('merged typing is capped by characters too, never through an emoji', () => {
    batcher.record(edit(1, 'a'.repeat(199)))
    batcher.record(edit(1, '😀😀'))
    batcher.flush()
    const merged = sent.at(-1)!.events[0]
    expect(merged.k === 'edit' && merged.ins).toBe(`${'a'.repeat(199)}😀`)
  })

  it('sends nothing after stop and works again after start', () => {
    batcher.stop()
    batcher.record({ k: 'focus', s: 'board' })
    vi.advanceTimersByTime(FLUSH_MS * 2)
    expect(sent).toHaveLength(0)
    batcher.start()
    batcher.record({ k: 'focus', s: 'board' })
    vi.advanceTimersByTime(FLUSH_MS)
    expect(sent).toHaveLength(1)
  })
})

describe('trimBatch', () => {
  const at = (i: number) => ({ t: i })
  it('keeps at most 60 events, dropping pointer samples before anything else, then the oldest', () => {
    const events = [
      ...Array.from({ length: 5 }, (_, i) => ({ k: 'ptr' as const, s: 'out' as const, ...at(i) })),
      ...Array.from({ length: 70 }, (_, i) => ({ k: 'focus' as const, s: 'code' as const, ...at(10 + i) })),
    ]
    const out = trimBatch(events)
    expect(out).toHaveLength(60)
    expect(out.some((e) => e.k === 'ptr')).toBe(false)
    expect(out[0].t).toBe(20) // the ten oldest focus events went too
  })

  it('keeps a batch under 4 KB', () => {
    const big = Array.from({ length: 30 }, (_, i) => ({ k: 'edit' as const, from_line: i + 1, to_line: i + 1, ins: 'z'.repeat(200), removed: 0, ...at(i) }))
    expect(JSON.stringify(trimBatch(big)).length).toBeLessThanOrEqual(MAX_BATCH_BYTES)
  })
})
