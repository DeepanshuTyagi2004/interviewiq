import { describe, it, expect } from 'vitest'
import { render, screen, renderHook, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LiveSessionProvider, useLiveSession } from './LiveSessionProvider'
import { MockLiveSession } from './MockLiveSession'
import type { ArtifactSnapshot, ConnState, ControlSignal, LiveSession, ProctorEvent } from './types'

function Probe() {
  const { state, ctx } = useLiveSession()
  return (
    <div>
      <span data-testid="state">{state}</span>
      <span data-testid="violations">{ctx.violations}</span>
    </div>
  )
}

describe('LiveSessionProvider', () => {
  it('provides machine state, starting at prejoin', async () => {
    const session = new MockLiveSession()
    render(<LiveSessionProvider sessionId="s1" session={session}><Probe /></LiveSessionProvider>)
    expect(screen.getByTestId('state').textContent).toBe('prejoin')
    expect(screen.getByTestId('violations').textContent).toBe('0')
    // session stays connectable independent of provider render — sanity check the injected double is live
    await act(async () => { await session.connect('s1') })
    expect(session.connectionState).toBe('connected')
  })

  it('useLiveSession throws outside a provider', () => {
    expect(() => renderHook(() => useLiveSession())).toThrow('useLiveSession must be used within a LiveSessionProvider')
  })
})

/** Bare-bones LiveSession stub whose onControl callback is exposed via `emit`, so a test can push
 * arbitrary ControlSignals straight through the provider's onControl→machine bridge without going
 * through MockLiveSession's scripted behavior (which doesn't cover every signal, e.g. `ended`). */
class StubLiveSession implements LiveSession {
  connectionState: ConnState = 'idle'
  private cb: ((c: ControlSignal) => void) | null = null
  async connect() { /* no-op */ }
  async disconnect() { /* no-op */ }
  getLocalStream() { return null }
  setMicEnabled() { /* no-op */ }
  setCameraEnabled() { /* no-op */ }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  sendArtifact(_a: ArtifactSnapshot) { /* no-op */ }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  sendProctorEvent(_e: ProctorEvent) { /* no-op */ }
  onControl(cb: (c: ControlSignal) => void) { this.cb = cb; return () => { this.cb = null } }
  onConnectionChange() { return () => { /* no-op */ } }
  emit(c: ControlSignal) { this.cb?.(c) }
}

function Bridge() {
  const { state, ctx, send, transcript } = useLiveSession()
  return (
    <div>
      <span data-testid="state">{state}</span>
      <span data-testid="violations">{ctx.violations}</span>
      <span data-testid="pausedReason">{ctx.pausedReason ?? ''}</span>
      <span data-testid="endedReason">{ctx.endedReason ?? ''}</span>
      <span data-testid="transcript">{transcript.join('|')}</span>
      <button onClick={() => send({ type: 'START_CHECKS' })}>start-checks</button>
      <button onClick={() => send({ type: 'CHECKS_PASSED' })}>checks-passed</button>
      <button onClick={() => send({ type: 'CONNECTED' })}>connected</button>
    </div>
  )
}

async function renderBridgeAtLive(session: StubLiveSession) {
  const user = userEvent.setup()
  render(<LiveSessionProvider sessionId="s1" session={session}><Bridge /></LiveSessionProvider>)
  await user.click(screen.getByRole('button', { name: 'start-checks' }))
  await user.click(screen.getByRole('button', { name: 'checks-passed' }))
  await user.click(screen.getByRole('button', { name: 'connected' }))
  expect(screen.getByTestId('state').textContent).toBe('live')
  return user
}

describe('LiveSessionProvider onControl -> machine bridge', () => {
  it('pause{reason} moves to paused, increments violations, and records pausedReason', async () => {
    const session = new StubLiveSession()
    await renderBridgeAtLive(session)

    act(() => session.emit({ type: 'pause', reason: 'fullscreen_exit' }))

    expect(screen.getByTestId('state').textContent).toBe('paused')
    expect(screen.getByTestId('violations').textContent).toBe('1')
    expect(screen.getByTestId('pausedReason').textContent).toBe('fullscreen_exit')
  })

  it('resume moves back to live', async () => {
    const session = new StubLiveSession()
    await renderBridgeAtLive(session)

    act(() => session.emit({ type: 'pause', reason: 'tab_hidden' }))
    act(() => session.emit({ type: 'resume' }))

    expect(screen.getByTestId('state').textContent).toBe('live')
  })

  it('ended{reason} moves to ended and records ctx.endedReason', async () => {
    const session = new StubLiveSession()
    await renderBridgeAtLive(session)

    act(() => session.emit({ type: 'ended', reason: 'candidate_left' }))

    expect(screen.getByTestId('state').textContent).toBe('ended')
    expect(screen.getByTestId('endedReason').textContent).toBe('candidate_left')
  })

  it('acknowledge_violation{text} appends to transcript', async () => {
    const session = new StubLiveSession()
    await renderBridgeAtLive(session)

    act(() => session.emit({ type: 'acknowledge_violation', text: 'Please return to full screen.' }))

    expect(screen.getByTestId('transcript').textContent).toContain('Please return to full screen.')
  })

  it('interviewer_utterance{text} appends to transcript', async () => {
    const session = new StubLiveSession()
    await renderBridgeAtLive(session)

    act(() => session.emit({ type: 'interviewer_utterance', text: "Let's begin." }))

    expect(screen.getByTestId('transcript').textContent).toContain("Let's begin.")
  })
})
