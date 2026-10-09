import { describe, expect, it } from 'vitest'
import { applySegment, systemNote, type TranscriptSegment } from './transcript'

const seg = (over: Partial<TranscriptSegment> = {}): TranscriptSegment => ({
  id: 's1', speaker: 'candidate', text: 'hel', final: false, at: 1, ...over,
})

describe('applySegment', () => {
  it('appends a new segment', () => {
    expect(applySegment([], seg())).toEqual([seg()])
  })

  it('updates an interim segment in place and keeps its first arrival time', () => {
    const list = applySegment(applySegment([], seg()), seg({ text: 'hello', at: 9 }))
    expect(list).toEqual([seg({ text: 'hello', at: 1 })])
  })

  it('ignores a late interim update after the segment is final', () => {
    const final = applySegment([seg()], seg({ text: 'hello there', final: true }))
    expect(applySegment(final, seg({ text: 'hello th' }))).toBe(final)
  })

  it('keeps arrival order when an earlier segment is finalised', () => {
    const list = [seg({ id: 'a' }), seg({ id: 'b', speaker: 'interviewer' })]
    expect(applySegment(list, seg({ id: 'a', text: 'x', final: true })).map((s) => s.id)).toEqual(['a', 'b'])
  })
})

describe('systemNote', () => {
  it('makes a final system segment with a unique id', () => {
    const a = systemNote('Tab change logged', 5)
    const b = systemNote('Tab change logged', 5)
    expect(a).toMatchObject({ speaker: 'system', text: 'Tab change logged', final: true, at: 5 })
    expect(a.id).not.toBe(b.id)
  })
})
