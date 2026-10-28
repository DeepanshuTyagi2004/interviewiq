import { describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MockLiveSession } from '../session/MockLiveSession'
import type { TranscriptSegment } from '../session/transcript'
import { WorkspaceProvider, useWorkspace } from '../workspace/WorkspaceProvider'
import { AskPill } from './AskPill'
import { TranscriptBubbles } from './TranscriptBubbles'

const seg = (id: string, speaker: TranscriptSegment['speaker'], text: string, final = true): TranscriptSegment => ({ id, speaker, text, final, at: 1 })

describe('TranscriptBubbles', () => {
  it('shows an empty state', () => {
    render(<TranscriptBubbles segments={[]} interviewerName="Asha" />)
    expect(screen.getByText(/conversation will appear here/i)).toBeInTheDocument()
  })

  it('labels each run once, keeps interim words dim and shows notices as chips', () => {
    render(
      <TranscriptBubbles
        interviewerName="Asha"
        segments={[seg('a', 'interviewer', 'Hi.'), seg('b', 'interviewer', 'Ready?'), seg('c', 'candidate', 'Yes, I', false), seg('n', 'system', 'Tab change logged')]}
      />,
    )
    expect(screen.getAllByText('Asha')).toHaveLength(1)
    expect(screen.getByText('You')).toBeInTheDocument()
    expect(screen.getByText('Yes, I')).toHaveAttribute('data-final', 'false')
    expect(screen.getByRole('note')).toHaveTextContent('Tab change logged')
  })
})

describe('TranscriptBubbles alignment', () => {
  it('puts the interviewer on the left and the candidate on the right', () => {
    render(<TranscriptBubbles interviewerName="Asha" segments={[seg('a', 'interviewer', 'Hi.'), seg('b', 'candidate', 'Hello.')]} />)
    expect(screen.getByText('Hi.').closest('[data-speaker]')).toHaveClass('self-start', 'text-left')
    expect(screen.getByText('Hello.').closest('[data-speaker]')).toHaveClass('self-end', 'text-right')
  })
})

describe('TranscriptBubbles size', () => {
  it('sets the type larger when the conversation has the room to itself', () => {
    const { rerender } = render(<TranscriptBubbles segments={[seg('a', 'interviewer', 'Hi.')]} interviewerName="Asha" />)
    const log = screen.getByRole('log')
    expect(log).toHaveClass('text-[13.5px]')
    rerender(<TranscriptBubbles segments={[seg('a', 'interviewer', 'Hi.')]} interviewerName="Asha" comfortable />)
    expect(log).toHaveClass('text-[15.5px]')
    expect(log).not.toHaveClass('text-[13.5px]')
  })

  it('looks at the newest line again when the size change settles, since the text has re-wrapped', () => {
    render(<TranscriptBubbles segments={[seg('a', 'interviewer', 'Hi.')]} interviewerName="Asha" />)
    const log = screen.getByRole('log')
    Object.defineProperty(log, 'scrollHeight', { configurable: true, value: 640 })
    log.scrollTop = 0
    fireEvent.transitionEnd(log)
    expect(log.scrollTop).toBe(640)
  })
})

describe('AskPill', () => {
  it('shows the pending selection and clears it', async () => {
    let ws: ReturnType<typeof useWorkspace> | null = null
    function Probe() { ws = useWorkspace(); return null }
    render(<WorkspaceProvider session={new MockLiveSession()}><AskPill /><Probe /></WorkspaceProvider>)
    expect(screen.queryByText(/asking about/i)).not.toBeInTheDocument()
    act(() => ws!.askAbout({ surface: 'code', quote: 'for c in s:' }))
    expect(screen.getByRole('status')).toHaveTextContent('for c in s:')
    await userEvent.click(screen.getByRole('button', { name: 'Clear the selection' }))
    expect(screen.queryByText(/asking about/i)).not.toBeInTheDocument()
  })
})
