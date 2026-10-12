import { describe, expect, it } from 'vitest'
import { ActivityBatcher, type BatchOut } from './batcher'

function make() {
  let t = 1_000
  const sent: BatchOut[] = []
  const batcher = new ActivityBatcher({ now: () => t, send: (b) => sent.push(b) })
  return { batcher, advance: (ms: number) => { t += ms }, sent }
}
const edit = (via?: 'typed' | 'other') => ({ k: 'edit' as const, from_line: 3, to_line: 3, ins: 'ab', removed: 0, ...(via ? { via } : {}) })

describe('merging edits', () => {
  it('merges consecutive edits that arrived the same way', () => {
    const { batcher, advance, sent } = make()
    batcher.record(edit('typed'))
    advance(100)
    batcher.record(edit('typed'))
    batcher.flush()
    expect(sent[0].events).toEqual([expect.objectContaining({ k: 'edit', ins: 'abab', via: 'typed' })])
  })

  it('keeps edits that arrived differently apart, so a paste is never hidden inside typing', () => {
    const { batcher, advance, sent } = make()
    batcher.record(edit('typed'))
    advance(100)
    batcher.record(edit('other'))
    batcher.flush()
    expect(sent[0].events.map((e) => (e.k === 'edit' ? e.via : null))).toEqual(['typed', 'other'])
  })

  it('still merges edits that carry no tag', () => {
    const { batcher, advance, sent } = make()
    batcher.record(edit())
    advance(100)
    batcher.record(edit())
    batcher.flush()
    expect(sent[0].events).toHaveLength(1)
  })
})
