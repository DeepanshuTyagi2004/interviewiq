import { describe, it, expect } from 'vitest'
import { MockLiveSession } from './MockLiveSession'
import type { ControlSignal } from './types'

describe('MockLiveSession', () => {
  it('connect acquires media, emits interviewer opening + speaking, exposes stream', async () => {
    const s = new MockLiveSession()
    const controls: ControlSignal[] = []
    s.onControl((c) => controls.push(c))
    await s.connect('sess-1')
    expect(s.connectionState).toBe('connected')
    expect(s.getLocalStream()).not.toBeNull()
    expect(controls.some((c) => c.type === 'interviewer_utterance')).toBe(true)
  })

  it('echoes pause on a fullscreen_exit proctor event and resume on restored', () => {
    const s = new MockLiveSession()
    const controls: ControlSignal[] = []
    s.onControl((c) => controls.push(c))
    s.sendProctorEvent({ type: 'fullscreen_exit', at: 1 })
    expect(controls.some((c) => c.type === 'pause')).toBe(true)
    s.sendProctorEvent({ type: 'fullscreen_restored', at: 2 })
    expect(controls.some((c) => c.type === 'resume')).toBe(true)
  })

  it('disconnect during an in-flight connect() supersedes it instead of resurrecting the session', async () => {
    const s = new MockLiveSession()
    const connectPromise = s.connect('sess-1')
    await s.disconnect()
    await connectPromise
    expect(s.connectionState).toBe('disconnected')
    expect(s.getLocalStream()).toBeNull()
  })
})
