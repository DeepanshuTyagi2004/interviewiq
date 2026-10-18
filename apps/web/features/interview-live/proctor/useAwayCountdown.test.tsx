import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { AwayEpisode } from './awayEpisode'
import { useAwayCountdown } from './useAwayCountdown'

beforeEach(() => {
  vi.useFakeTimers()
  document.title = 'Interview'
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useAwayCountdown', () => {
  it('counts down once a second, to the limit and then the cap, and shows it in the tab title', () => {
    const away: AwayEpisode = { startedAt: Date.now(), kinds: ['tab_hidden'], tight: true }
    const { result, unmount } = renderHook(() => useAwayCountdown(away))
    expect(result.current).toEqual({ phase: 'limit', seconds: 4 })
    expect(document.title).toBe('⚠ Return in 4 s')
    act(() => { vi.advanceTimersByTime(2000) })
    expect(result.current).toEqual({ phase: 'limit', seconds: 2 })
    act(() => { vi.advanceTimersByTime(11_000) })
    expect(result.current).toEqual({ phase: 'cap', seconds: 47 })
    expect(document.title).toBe('⚠ Interview ends in 47 s')
    unmount()
    expect(document.title).toBe('Interview')
  })

  it('is nothing, and leaves the title alone, while the candidate is on the screen', () => {
    const { result } = renderHook(() => useAwayCountdown(null))
    expect(result.current).toBeNull()
    expect(document.title).toBe('Interview')
  })

  it('restores the title when the candidate comes back', () => {
    const away: AwayEpisode = { startedAt: Date.now(), kinds: ['fullscreen_exit'], tight: false }
    const { rerender } = renderHook(({ a }: { a: AwayEpisode | null }) => useAwayCountdown(a), { initialProps: { a: away as AwayEpisode | null } })
    expect(document.title).toBe('⚠ Return in 30 s')
    rerender({ a: null })
    expect(document.title).toBe('Interview')
  })
})
