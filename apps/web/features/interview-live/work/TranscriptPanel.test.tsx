import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TranscriptPanel } from './TranscriptPanel'
import type { TranscriptEntry } from '../session/types'

describe('TranscriptPanel', () => {
  it('shows the empty state when there are no entries', () => {
    render(<TranscriptPanel entries={[]} interviewerName="Ada" />)
    expect(screen.getByText('The conversation will appear here.')).toBeInTheDocument()
  })

  it('renders interviewer, candidate, and system entries with the right speaker labels', () => {
    const entries: TranscriptEntry[] = [
      { speaker: 'interviewer', text: "Let's begin." },
      { speaker: 'candidate', text: 'Sure, sounds good.' },
      { speaker: 'system', text: 'Please return to full screen.' },
    ]
    render(<TranscriptPanel entries={entries} interviewerName="Ada" />)

    // Speaker labels are now the design's small mono eyebrows ("ADA", "YOU", "SYSTEM") above
    // each line, so they no longer carry a trailing colon.
    expect(screen.getByText('Ada')).toBeInTheDocument()
    expect(screen.getByText("Let's begin.")).toBeInTheDocument()

    expect(screen.getByText('You')).toBeInTheDocument()
    expect(screen.getByText('Sure, sounds good.')).toBeInTheDocument()

    expect(screen.getByText('System')).toBeInTheDocument()
    expect(screen.getByText('Please return to full screen.')).toBeInTheDocument()
  })

  it('exposes the transcript as an accessible log region', () => {
    render(<TranscriptPanel entries={[]} interviewerName="Ada" />)
    expect(screen.getByRole('log', { name: /conversation transcript/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /transcript/i })).toBeInTheDocument()
  })
})
