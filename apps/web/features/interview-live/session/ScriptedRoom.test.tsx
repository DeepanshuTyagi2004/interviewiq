import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LiveInterviewInner } from '@/app/(app)/interviews/[sessionId]/live/_components/LiveInterview'
import { LiveSessionProvider, useLiveSession } from './LiveSessionProvider'
import { ScriptedLiveSession } from './ScriptedLiveSession'


vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/features/interview-live/work/CodeEditor', () => ({ CodeEditor: () => <div data-testid="code-editor" /> }))
vi.mock('@/features/interview-live/work/DiagramBoard', () => ({ DiagramBoard: () => <div data-testid="diagram-board" /> }))


type Live = ReturnType<typeof useLiveSession>

describe('scripted interview room', () => {
  it('runs the scripted round through the protocol and ends on the candidate request', async () => {
    const liveRef: { current: Live | null } = { current: null }
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
    await waitFor(() => expect(document.querySelector('mark[data-author="interviewer"]')).not.toBeNull())
    expect(screen.getByText(/the problem is on your screen/i)).toBeInTheDocument()
    // The editor is stubbed here, so the scripted comment is refused and the refusal is acknowledged.
    await waitFor(() => expect(session.sentOf('ack').some((a) => !a.ok && a.reason === 'editor_not_ready')).toBe(true))

    await userEvent.click(screen.getByRole('button', { name: 'End interview' }))
    await userEvent.click(screen.getAllByRole('button', { name: 'End interview' }).at(-1)!)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'You ended the interview' })).toBeInTheDocument())
  })
})

describe('scripted session activity log', () => {
  it('logs the activity batches it receives, for checking capture in the mock room', () => {
    const session = new ScriptedLiveSession({ speed: 0 })
    const log = vi.spyOn(console, 'debug').mockImplementation(() => {})
    session.send({ type: 'activity.batch', sent_at: 5, events: [{ k: 'focus', t: 4, s: 'code' }] })
    expect(log).toHaveBeenCalledWith('[iq-activity]', JSON.stringify([{ k: 'focus', t: 4, s: 'code' }]))
    log.mockRestore()
  })
})
