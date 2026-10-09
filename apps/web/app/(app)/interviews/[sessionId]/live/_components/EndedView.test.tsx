import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { EndReason } from '@/features/interview-live/protocol/messages'
import { EndedView } from './EndedView'

const h = vi.hoisted(() => ({ state: 'ended', reason: 'completed' as string | null, message: null as string | null }))
vi.mock('@/features/interview-live/session/useLiveSession', () => ({
  useLiveSession: () => ({ state: h.state, ctx: { endedReason: h.reason, endedMessage: h.message } }),
}))

function show(reason: EndReason | null, message: string | null = null, state = 'ended') {
  Object.assign(h, { reason, message, state })
  render(<EndedView sessionId="s1" />)
}

describe('EndedView', () => {
  it('waits while the interviewer says goodbye', () => {
    show(null, null, 'ending')
    expect(screen.getByRole('status')).toHaveTextContent(/ending the interview/i)
  })

  it('shows the closing line and the debrief link after a completed round', () => {
    show('completed', 'Thanks, that was great.')
    expect(screen.getByRole('heading', { name: 'Interview complete' })).toBeInTheDocument()
    expect(screen.getByText('Thanks, that was great.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /view debrief/i })).toHaveAttribute('href', '/interviews/s1/report')
  })

  it('gives the interviewer reason and says the round counts as an attempt', () => {
    show('ended_by_interviewer', 'I am ending the interview because of repeated tab switching.')
    expect(screen.getByRole('heading', { name: 'The interviewer ended the interview' })).toBeInTheDocument()
    expect(screen.getByText(/repeated tab switching/)).toBeInTheDocument()
    expect(screen.getByText('This counts as an attempt.')).toBeInTheDocument()
  })

  it('confirms a candidate end', () => {
    show('candidate_ended')
    expect(screen.getByRole('heading', { name: 'You ended the interview' })).toBeInTheDocument()
  })

  it('offers only the way back after a lost connection', () => {
    show('technical')
    expect(screen.getByRole('heading', { name: 'Connection lost' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /view debrief/i })).not.toBeInTheDocument()
  })
})
