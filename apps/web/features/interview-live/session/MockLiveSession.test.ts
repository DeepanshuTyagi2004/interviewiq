import { describe, expect, it } from 'vitest'
import { stampAgent } from '../protocol/messages'
import { MockLiveSession } from './MockLiveSession'

describe('MockLiveSession', () => {
  it('connects with local media and reports the agent listening', async () => {
    const s = new MockLiveSession()
    const states: string[] = []
    s.onAgentState((a) => states.push(a))
    await s.connect('s1')
    expect(s.connectionState).toBe('connected')
    expect(s.getLocalStream()).not.toBeNull()
    expect(states).toEqual(['listening'])
  })

  it('stamps and records what the room sends', async () => {
    const s = new MockLiveSession()
    const id = s.send({ type: 'workspace.hello', has_content: false })
    await s.sendBytes('board.snapshot', new Uint8Array([1]), { request_id: 'r' })
    expect(s.sentOf('workspace.hello')[0]).toMatchObject({ v: 1, id, has_content: false })
    expect(s.bytes[0]).toMatchObject({ kind: 'board.snapshot', attributes: { request_id: 'r' } })
  })

  it('plays the agent side to subscribers and stops after unsubscribe', () => {
    const s = new MockLiveSession()
    const got: string[] = []
    const off = s.onMessage((m) => got.push(m.type))
    s.emitMessage(stampAgent({ type: 'panel.clear_highlight', highlight_id: 'h' }))
    off()
    s.emitMessage(stampAgent({ type: 'panel.clear_highlight', highlight_id: 'h' }))
    expect(got).toEqual(['panel.clear_highlight'])
  })

  it('disconnects once', async () => {
    const s = new MockLiveSession()
    const seen: string[] = []
    s.onConnectionChange((c) => seen.push(c))
    await s.connect('s1')
    await s.disconnect()
    await s.disconnect()
    expect(seen.filter((c) => c === 'disconnected')).toHaveLength(1)
  })
})
