import { describe, expect, it } from 'vitest'
import { capCodePoints, wellFormed } from './text'

const LONE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/

describe('capCodePoints', () => {
  it('cuts by characters, never through an emoji', () => {
    const out = capCodePoints(`${'a'.repeat(199)}😀😀`, 200)
    expect(out).toBe(`${'a'.repeat(199)}😀`)
    expect(LONE.test(out)).toBe(false)
  })
  it('leaves short text alone', () => {
    expect(capCodePoints('😀 hi', 10)).toBe('😀 hi')
  })
})

describe('wellFormed', () => {
  it('drops a lone surrogate, which would make the whole batch unparseable on the worker', () => {
    expect(wellFormed('ab\ud83dcd')).toBe('abcd')
    expect(wellFormed('ok 😀')).toBe('ok 😀')
  })
})
