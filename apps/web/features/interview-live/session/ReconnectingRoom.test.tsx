import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { LiveInterviewInner } from '@/app/(app)/interviews/[sessionId]/live/_components/LiveInterview'
import { LiveSessionProvider, useLiveSession } from './LiveSessionProvider'
import { ScriptedLiveSession } from './ScriptedLiveSession'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/features/interview-live/work/CodeEditor', () => ({ CodeEditor: () => <div data-testid="code-editor" /> }))
vi.mock('@/features/interview-live/work/DiagramBoard', () => ({ DiagramBoard: () => <div data-testid="diagram-board" /> }))

describe('a dropped connection during the round', () => {
  it('keeps the room mounted behind a banner, so the editor, board and proctoring keep their state', async () => {
    const liveRef: { current: ReturnType<typeof useLiveSession> | null } = { current: null }
    function Probe() {
      liveRef.current = useLiveSession()
      return null
    }
    const session = new ScriptedLiveSession({ speed: 0 })
    await session.connect('s1')
    ;(document as unknown as { fullscreenElement: Element | null }).fullscreenElement = document.documentElement
    render(
      <LiveSessionProvider sessionId="s1" session={session}>
        <Probe />
        <div className="fixed inset-0"><LiveInterviewInner sessionId="s1" /></div>
      </LiveSessionProvider>,
    )
    act(() => {
      liveRef.current!.send({ type: 'START_CHECKS' })
      liveRef.current!.send({ type: 'CHECKS_PASSED' })
      liveRef.current!.send({ type: 'CONNECTED' })
    })
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Problem 1' })).toBeInTheDocument())
    const editor = screen.getByTestId('code-editor')

    act(() => session.simulateConnection('reconnecting'))
    expect(liveRef.current!.state).toBe('reconnecting')
    expect(screen.getByTestId('code-editor')).toBe(editor)                       // the same node: nothing was unmounted
    expect(screen.getByRole('tab', { name: 'Problem 1' })).toBeInTheDocument()
    expect(screen.getByText(/connection lost/i)).toBeInTheDocument()

    act(() => session.simulateConnection('connected'))
    expect(liveRef.current!.state).toBe('live')
    expect(screen.getByTestId('code-editor')).toBe(editor)
    expect(screen.queryByText(/connection lost/i)).toBeNull()
  })
})
