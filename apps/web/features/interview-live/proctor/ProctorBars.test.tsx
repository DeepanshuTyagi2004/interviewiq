import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import type { AwayEpisode } from './awayEpisode'
import { ProctorBars } from './ProctorBars'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('ProctorBars return clock', () => {
  it('counts down to the limit, then to the end of the interview', () => {
    const away: AwayEpisode = { startedAt: Date.now(), kinds: ['tab_hidden'], tight: true }
    render(<ProctorBars outOfFullscreen={false} shareStopped={false} toast={null} away={away} />)
    expect(screen.getByText(/Return to the interview within 4 s/)).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(20_000) })
    expect(screen.getByText(/Return now\. The interview ends in 40 s/)).toBeInTheDocument()
  })

  it('says nothing about time while the candidate is on the screen', () => {
    render(<ProctorBars outOfFullscreen={false} shareStopped={false} toast={null} away={null} />)
    expect(screen.queryByText(/Return/)).toBeNull()
  })

  it('still shows the return-to-full-screen bar beside the countdown', () => {
    const away: AwayEpisode = { startedAt: Date.now(), kinds: ['fullscreen_exit'], tight: false }
    render(<ProctorBars outOfFullscreen shareStopped={false} toast={null} away={away} />)
    expect(screen.getByRole('button', { name: 'Return to full screen' })).toBeInTheDocument()
    expect(screen.getByText(/within 30 s/)).toBeInTheDocument()
  })
})

describe('ProctorBars camera check', () => {
  it('says what to fix while a camera violation lasts, and nothing otherwise', () => {
    const { rerender } = render(<ProctorBars outOfFullscreen={false} shareStopped={false} toast={null} camera="multiple_faces" />)
    expect(screen.getByText('Someone else is in view. Only you should be on camera.')).toBeInTheDocument()
    rerender(<ProctorBars outOfFullscreen={false} shareStopped={false} toast={null} camera={null} />)
    expect(screen.queryByText(/on camera/)).not.toBeInTheDocument()
  })
})
