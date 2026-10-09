import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { stampAgent } from '../protocol/messages'
import { END_FALLBACK_MS, LiveSessionProvider, useLiveSession } from './LiveSessionProvider'
import { MockLiveSession } from './MockLiveSession'

const api = vi.hoisted(() => ({ endLive: vi.fn(async () => ({ status: 'COMPLETED', endReason: 'candidate_ended', alreadyEnded: false })) }))
vi.mock('@/features/interview/api', () => api)

type Ctx = ReturnType<typeof useLiveSession>
function mount(session: MockLiveSession) {
  const ref: { current: Ctx | null } = { current: null }
  function Probe() {
    ref.current = useLiveSession()
    return null
  }
  render(<LiveSessionProvider sessionId="s1" session={session}><Probe /></LiveSessionProvider>)
  const goLive = () => act(() => {
    ref.current!.send({ type: 'START_CHECKS' })
    ref.current!.send({ type: 'CHECKS_PASSED' })
    ref.current!.send({ type: 'CONNECTED' })
  })
  return { ref, goLive }
}

afterEach(() => { vi.useRealTimers() })

describe('LiveSessionProvider', () => {
  it('collects transcript segments and the agent state', () => {
    const session = new MockLiveSession()
    const { ref } = mount(session)
    act(() => {
      session.emitTranscript({ id: 'a', speaker: 'interviewer', text: 'Hi', final: false, at: 1 })
      session.emitTranscript({ id: 'a', speaker: 'interviewer', text: 'Hi there', final: true, at: 2 })
      session.emitAgentState('speaking')
      ref.current!.addNote('Tab change logged')
    })
    expect(ref.current!.transcript.map((s) => s.text)).toEqual(['Hi there', 'Tab change logged'])
    expect(ref.current!.agentState).toBe('speaking')
  })

  it('ends with the interviewer reason and message on session.ending', () => {
    const session = new MockLiveSession()
    const { ref, goLive } = mount(session)
    goLive()
    act(() => session.emitMessage(stampAgent({ type: 'session.ending', reason: 'ended_by_interviewer', message: 'Repeated tab switching.' })))
    expect(ref.current!.state).toBe('ended')
    expect(ref.current!.ctx).toEqual({ endedReason: 'ended_by_interviewer', endedMessage: 'Repeated tab switching.' })
  })

  it('ends as technical when the connection drops during the round', () => {
    const session = new MockLiveSession()
    const { ref, goLive } = mount(session)
    goLive()
    act(() => session.simulateConnection('disconnected'))
    expect(ref.current!.ctx.endedReason).toBe('technical')
  })

  it('requestEnd asks the interviewer to end, and ends locally if it never answers', async () => {
    vi.useFakeTimers()
    const session = new MockLiveSession()
    const { ref, goLive } = mount(session)
    goLive()
    act(() => ref.current!.requestEnd())
    expect(ref.current!.state).toBe('ending')
    expect(session.sentOf('session.end_request')).toHaveLength(1)
    await act(async () => { vi.advanceTimersByTime(END_FALLBACK_MS) })
    expect(ref.current!.state).toBe('ended')
    expect(ref.current!.ctx.endedReason).toBe('candidate_ended')
    expect(api.endLive).toHaveBeenCalledWith('s1')
  })

  it('gives the interviewer twelve seconds to answer End before ending locally', async () => {
    vi.useFakeTimers()
    const session = new MockLiveSession()
    const { ref, goLive } = mount(session)
    goLive()
    act(() => ref.current!.requestEnd())
    act(() => { vi.advanceTimersByTime(11_999) })
    expect(ref.current!.state).toBe('ending')            // the interviewer's own watchdog (8 s) and closing line fit inside this
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(ref.current!.state).toBe('ended')
  })

  it('does not call the API fallback when the interviewer answers End in time', () => {
    vi.useFakeTimers()
    api.endLive.mockClear()
    const session = new MockLiveSession()
    const { ref, goLive } = mount(session)
    goLive()
    act(() => ref.current!.requestEnd())
    act(() => session.emitMessage(stampAgent({ type: 'session.ending', reason: 'candidate_ended', message: 'Goodbye.' })))
    act(() => { vi.advanceTimersByTime(END_FALLBACK_MS) })
    expect(api.endLive).not.toHaveBeenCalled()
  })

  it('never labels a disconnect after End as technical', async () => {
    const session = new MockLiveSession()
    const { ref, goLive } = mount(session)
    goLive()
    act(() => ref.current!.requestEnd())
    await act(async () => session.simulateConnection('disconnected'))
    expect(ref.current!.ctx.endedReason).toBe('candidate_ended')
  })

  it('words the ending from the API when the interviewer had already ended the round and its goodbye never arrived', async () => {
    vi.useFakeTimers()
    api.endLive.mockResolvedValueOnce({ status: 'COMPLETED', endReason: 'ended_by_interviewer', alreadyEnded: true })
    const session = new MockLiveSession()
    const { ref, goLive } = mount(session)
    goLive()
    act(() => ref.current!.requestEnd())
    await act(async () => { vi.advanceTimersByTime(END_FALLBACK_MS) })
    expect(ref.current!.state).toBe('ended')
    expect(ref.current!.ctx.endedReason).toBe('ended_by_interviewer')
  })

  it('does the same when the room is deleted after End and the interviewer ended it first', async () => {
    api.endLive.mockResolvedValueOnce({ status: 'COMPLETED', endReason: 'ended_by_interviewer', alreadyEnded: true })
    const session = new MockLiveSession()
    const { ref, goLive } = mount(session)
    goLive()
    act(() => ref.current!.requestEnd())
    await act(async () => session.simulateConnection('disconnected'))
    expect(ref.current!.ctx.endedReason).toBe('ended_by_interviewer')
  })

  it('still ends as candidate_ended when the API cannot be reached', async () => {
    vi.useFakeTimers()
    api.endLive.mockRejectedValueOnce(new Error('offline'))
    const session = new MockLiveSession()
    const { ref, goLive } = mount(session)
    goLive()
    act(() => ref.current!.requestEnd())
    await act(async () => { vi.advanceTimersByTime(END_FALLBACK_MS) })
    expect(ref.current!.ctx.endedReason).toBe('candidate_ended')
  })
})
