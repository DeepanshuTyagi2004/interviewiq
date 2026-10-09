import { describe, expect, it } from 'vitest'
import { MAX_INSERT_LINES, commentLines, insertionText, overlaps, resolveLine, starterText } from './codeOps'

const CODE = ['def f(s):', '    seen = {}', '    for c in s:', '        seen[c] = 1', '    return len(seen)']

describe('resolveLine', () => {
  it('lands at the top for "top"', () => {
    expect(resolveLine(CODE, 'top')).toBe(1)
  })

  it('lands on the line when its text still matches (ignoring indentation)', () => {
    expect(resolveLine(CODE, { line: 3, expect: 'for c in s:' })).toBe(3)
  })

  it('follows the line when the candidate added lines above it', () => {
    const moved = ['# notes', '# more notes', ...CODE]
    expect(resolveLine(moved, { line: 3, expect: '    for c in s:' })).toBe(5)
  })

  it('matches a blank expected line only at its exact line, never a blank line nearby', () => {
    const lines = ['def f():', '', '    x = 1', '', '    return x']
    expect(resolveLine(lines, { line: 2, expect: '' })).toBe(2)
    expect(resolveLine(lines, { line: 3, expect: '' })).toBeNull()   // line 3 is code now; the blank lines are the wrong ones
  })

  it('refuses when the line is gone or too far away', () => {
    expect(resolveLine(CODE, { line: 3, expect: 'while True:' })).toBeNull()
    const far = [...Array(7).fill('#'), ...CODE]
    expect(resolveLine(far, { line: 3, expect: 'for c in s:' })).toBeNull()
  })
})

describe('commentLines and insertionText', () => {
  it('uses each language comment syntax', () => {
    expect(commentLines('python', 'Why?')).toEqual(['# Why?'])
    expect(commentLines('java', 'Why?\nAnd?')).toEqual(['// Why?', '// And?'])
    expect(starterText('go')).toBe('// write your solution here\n')
  })

  it('ends every insertion with a newline and limits code inserts', () => {
    expect(insertionText('python', 'comment', 'Edge case?')).toBe('# Edge case?\n')
    expect(insertionText('python', 'code', 'print(f("ab"))\n')).toBe('print(f("ab"))\n')
    const long = Array.from({ length: MAX_INSERT_LINES + 1 }, (_, i) => `x${i} = ${i}`).join('\n')
    expect(insertionText('python', 'code', long)).toBeNull()
  })
})

describe('overlaps', () => {
  it('detects touching line ranges', () => {
    expect(overlaps(1, 2, 2, 4)).toBe(true)
    expect(overlaps(5, 6, 2, 4)).toBe(false)
  })
})
