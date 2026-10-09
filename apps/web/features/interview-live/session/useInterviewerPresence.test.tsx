import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { ABSENT_NOTICE_MS, NUDGE_EVERY_MS, useInterviewerPresence } from './useInterviewerPresence'
import type { AgentState } from './types'

afterEach(() => { vi.useRealTimers() })

describe('useInterviewerPresence', () => {
  it('says "joining" after 10 s without an interviewer, "reconnecting" once one left, and nudges the API every 30 s', () => {
    vi.useFakeTimers()
    const nudge = vi.fn(async () => ({}))
    const { result, rerender } = renderHook(({ s }: { s: AgentState }) => useInterviewerPresence(s, 's1', nudge), { initialProps: { s: 'absent' as AgentState } })
    expect(result.current).toBe('present')
    act(() => { vi.advanceTimersByTime(ABSENT_NOTICE_MS) })
    expect(result.current).toBe('joining')
    act(() => { vi.advanceTimersByTime(NUDGE_EVERY_MS) })
    expect(nudge).toHaveBeenCalledWith('s1')
    rerender({ s: 'listening' })
    expect(result.current).toBe('present')
    rerender({ s: 'absent' })
    act(() => { vi.advanceTimersByTime(ABSENT_NOTICE_MS) })
    expect(result.current).toBe('reconnecting')
  })

  it('stops nudging as soon as the interviewer is there', () => {
    vi.useFakeTimers()
    const nudge = vi.fn(async () => ({}))
    const { rerender } = renderHook(({ s }: { s: AgentState }) => useInterviewerPresence(s, 's1', nudge), { initialProps: { s: 'absent' as AgentState } })
    rerender({ s: 'thinking' })
    act(() => { vi.advanceTimersByTime(NUDGE_EVERY_MS * 3) })
    expect(nudge).not.toHaveBeenCalled()
  })
})
