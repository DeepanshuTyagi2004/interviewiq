import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const warmLive = vi.fn(async (_id: string) => ({ warming: true }))
vi.mock('@/features/interview/api', () => ({ warmLive: (id: string) => warmLive(id) }))
const mock = vi.hoisted(() => ({ on: false }))
vi.mock('./mockMode', () => ({ isMockMode: () => mock.on }))

import { useWarmInterviewer } from './useWarmInterviewer'

describe('useWarmInterviewer', () => {
  beforeEach(() => {
    warmLive.mockReset()
    warmLive.mockImplementation(async () => ({ warming: true }))
    mock.on = false
  })

  it('asks the API to get the interviewer ready once per mount, however often the page re-renders or the instructions flag flips', () => {
    const { rerender } = renderHook(({ on }) => useWarmInterviewer('s1', on), { initialProps: { on: true } })
    rerender({ on: true })
    rerender({ on: false })
    rerender({ on: true })
    expect(warmLive).toHaveBeenCalledTimes(1)
    expect(warmLive).toHaveBeenCalledWith('s1')
  })

  it('does nothing while it is not the instructions page', () => {
    renderHook(() => useWarmInterviewer('s1', false))
    expect(warmLive).not.toHaveBeenCalled()
  })

  it('does nothing in local mock mode', () => {
    mock.on = true
    renderHook(() => useWarmInterviewer('s1', true))
    expect(warmLive).not.toHaveBeenCalled()
  })

  it('swallows a failed call: the room still works without it', async () => {
    warmLive.mockRejectedValueOnce(new Error('offline'))
    renderHook(() => useWarmInterviewer('s1', true))
    await new Promise((resolve) => setTimeout(resolve, 0)) // an unhandled rejection would fail the run
    expect(warmLive).toHaveBeenCalledTimes(1)
  })
})
