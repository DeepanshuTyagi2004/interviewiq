import { describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
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
