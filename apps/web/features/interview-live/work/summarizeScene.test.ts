import { describe, it, expect } from 'vitest'
import { summarizeScene } from './summarizeScene'

describe('summarizeScene', () => {
  it('summarizes shapes + text into readable lines', () => {
    const els = [
      { type: 'rectangle', id: 'a', text: '' },
      { type: 'text', id: 't1', text: 'User Service' },
      { type: 'arrow', id: 'ar', startBinding: { elementId: 'a' }, endBinding: { elementId: 't1' } },
    ]
    const out = summarizeScene(els)
    expect(out).toContain('rectangle')
    expect(out).toContain('User Service')
    expect(out).toContain('arrow')
  })

  it('empty scene → empty-ish summary', () => {
    expect(summarizeScene([])).toMatch(/no|empty/i)
  })

  it('skips deleted elements', () => {
    const els = [
      { type: 'rectangle', id: 'a', isDeleted: true },
      { type: 'rectangle', id: 'b' },
    ]
    const out = summarizeScene(els)
    expect(out).not.toContain('[a]')
    expect(out).toContain('[b]')
  })

  it('renders line elements like arrows', () => {
    const els = [{ type: 'line', id: 'l1', startBinding: { elementId: 'x' }, endBinding: { elementId: 'y' } }]
    const out = summarizeScene(els)
    expect(out).toContain('line: x → y')
  })

  it('falls back to "?" for arrows with missing bindings', () => {
    const els = [{ type: 'arrow', id: 'ar' }]
    const out = summarizeScene(els)
    expect(out).toContain('arrow: ? → ?')
  })
})
