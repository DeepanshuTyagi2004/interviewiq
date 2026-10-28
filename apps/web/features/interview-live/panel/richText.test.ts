import { describe, expect, it } from 'vitest'
import { formatRuns, isBoundLine, runsIn, type Run } from './richText'

/** The runs as markup-ish text: superscripts as ^(x), code as `x`, bold as *x*. */
function show(runs: Run[]): string {
  let out = ''
  let wrap: Run['wrap']
  for (const r of runs) {
    if (wrap && r.wrap?.id !== wrap.id) out += wrap.kind === 'code' ? '`' : '*'
    if (r.wrap && r.wrap.id !== wrap?.id) out += r.wrap.kind === 'code' ? '`' : '*'
    wrap = r.wrap
    out += r.sup ? `^(${r.text})` : r.text
  }
  if (wrap) out += wrap.kind === 'code' ? '`' : '*'
  return out
}

describe('formatRuns', () => {
  it('writes powers as superscripts and the comparison operators as symbols', () => {
    expect(show(formatRuns('1 <= n <= 10^5'))).toBe('1 ≤ n ≤ 10^(5)')
    expect(show(formatRuns('-10^9 <= nums[i] <= 10^9'))).toBe('-10^(9) ≤ nums[i] ≤ 10^(9)')
    expect(show(formatRuns('2^{31} - 1 and 10**9 + 7'))).toBe('2^(31) - 1 and 10^(9) + 7')
    expect(show(formatRuns('1 <= k <= 2 * 10^4, a != b'))).toBe('1 ≤ k ≤ 2 × 10^(4), a ≠ b')
    expect(show(formatRuns('Aim for O(n^2) or better.'))).toBe('Aim for O(n^(2)) or better.')
  })

  it('writes back a power that lost its caret, in a bound line only', () => {
    expect(show(formatRuns('1 <= nums.length <= 105'))).toBe('1 ≤ nums.length ≤ 10^(5)')
    expect(show(formatRuns('-231 <= x <= 231 - 1'))).toBe('-2^(31) ≤ x ≤ 2^(31) - 1')
    expect(show(formatRuns('0 <= val <= 1018'))).toBe('0 ≤ val ≤ 10^(18)')
    expect(show(formatRuns('1 <= n <= 100'))).toBe('1 ≤ n ≤ 100')
    expect(show(formatRuns('The shop sold 105 items.'))).toBe('The shop sold 105 items.')
  })

  it('shows inline code and bold without their markers, and a power between digits is never bold', () => {
    expect(show(formatRuns('Return `nums[i]` for **every** i.'))).toBe('Return `nums[i]` for *every* i.')
    expect(show(formatRuns('`1 <= n <= 10^5`'))).toBe('`1 ≤ n ≤ 10^(5)`')
    expect(show(formatRuns('10**5 and 2**3'))).toBe('10^(5) and 2^(3)')
  })

  it('keeps line breaks and maps every run back to its source', () => {
    const src = 'a <= 10^5\n`b`'
    const runs = formatRuns(src)
    expect(show(runs)).toBe('a ≤ 10^(5)\n`b`')
    for (const r of runs) if (!r.symbol) expect(src.slice(r.start, r.end)).toBe(r.text)
  })
})

describe('runsIn', () => {
  it('cuts the runs at a highlight and keeps a symbol whole on the side it starts', () => {
    const runs = formatRuns('n <= 10^5 here')
    expect(show(runsIn(runs, 0, 3))).toBe('n ≤')
    expect(show(runsIn(runs, 3, 9))).toBe(' 10^(5)')
    expect(show(runsIn(runs, 9, 14))).toBe(' here')
  })
})

describe('isBoundLine', () => {
  it('tells a bound from prose', () => {
    expect(isBoundLine('1 <= n <= 105')).toBe(true)
    expect(isBoundLine('- n >= 2')).toBe(true)
    expect(isBoundLine('Return the 105th element.')).toBe(false)
  })
})
