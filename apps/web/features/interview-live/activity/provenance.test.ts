import { describe, expect, it } from 'vitest'
import { TYPED_WINDOW_MS, classifyChange, createProvenance, isUnattributed, type ProvenanceState } from './provenance'

const idle: ProvenanceState = { lastKeyAt: null, localPasting: false, interviewerEditing: false }

describe('classifyChange', () => {
  it('calls a short change right after a key press typed', () => {
    expect(classifyChange({ text: 'x' }, { ...idle, lastKeyAt: 1000 }, 1000 + TYPED_WINDOW_MS)).toBe('typed')
    expect(classifyChange({ text: '()' }, { ...idle, lastKeyAt: 1000 }, 1050)).toBe('typed')        // an auto-closed pair
    expect(classifyChange({ text: '\n    ' }, { ...idle, lastKeyAt: 1000 }, 1050)).toBe('typed')    // Enter with auto-indent
  })

  it('calls a change with no key shortly before it other', () => {
    expect(classifyChange({ text: 'x' }, idle, 5000)).toBe('other')
    expect(classifyChange({ text: 'x' }, { ...idle, lastKeyAt: 1000 }, 1000 + TYPED_WINDOW_MS + 1)).toBe('other')
  })

  it('does not call a long change typed even right after a key press', () => {
    expect(classifyChange({ text: 'x'.repeat(40) }, { ...idle, lastKeyAt: 1000 }, 1010)).toBe('other')
  })

  it('names the known sources first, whatever keys were pressed', () => {
    const keyed = { ...idle, lastKeyAt: 1000 }
    expect(classifyChange({ text: 'x' }, { ...keyed, interviewerEditing: true }, 1010)).toBe('interviewer')
    expect(classifyChange({ text: 'x'.repeat(50) }, { ...keyed, localPasting: true }, 1010)).toBe('local_paste')
    expect(classifyChange({ text: 'x', isUndoing: true }, keyed, 1010)).toBe('undo')
    expect(classifyChange({ text: 'x', isRedoing: true }, keyed, 1010)).toBe('undo')
  })
})

describe('isUnattributed', () => {
  it('is an unexplained change of 30 or more characters', () => {
    expect(isUnattributed('other', 'x'.repeat(30))).toBe(true)
    expect(isUnattributed('other', 'x'.repeat(29))).toBe(false)
    expect(isUnattributed('typed', 'x'.repeat(100))).toBe(false)
    expect(isUnattributed('local_paste', 'x'.repeat(100))).toBe(false)
  })
})

describe('createProvenance', () => {
  function make() {
    let now = 1000
    let interviewer = false
    const p = createProvenance({ now: () => now, interviewerEditing: () => interviewer })
    return { p, at: (t: number) => { now = t }, interviewer: (on: boolean) => { interviewer = on } }
  }

  it('remembers the last key press', () => {
    const { p, at } = make()
    p.keyPressed()
    at(1100)
    expect(p.classify({ text: 'a' })).toBe('typed')
    at(1400)
    expect(p.classify({ text: 'a' })).toBe('other')
  })

  it('tags changes made inside asLocalPaste, and only those, even if the paste throws', () => {
    const { p } = make()
    let during = ''
    expect(() => p.asLocalPaste(() => { during = p.classify({ text: 'pasted' }); throw new Error('boom') })).toThrow('boom')
    expect(during).toBe('local_paste')
    expect(p.classify({ text: 'pasted' })).toBe('other')
  })

  it('asks the editor adapter whether the interviewer is editing', () => {
    const { p, interviewer } = make()
    interviewer(true)
    expect(p.classify({ text: 'stub' })).toBe('interviewer')
  })
})
