import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentMessage } from '../protocol/messages'
import { ScriptedLiveSession } from './ScriptedLiveSession'

type Room = { layout: 'talk' | 'work'; slow: boolean; at: number }

/** Plays the scripted interviewer on fake timers and records every `room.state` it sends, with its time. */
function setup(speed = 1) {
  const session = new ScriptedLiveSession({ speed })
  const rooms: Room[] = []
  const all: { type: AgentMessage['type']; at: number; layout?: string }[] = []
  const t0 = Date.now()
  session.onMessage((m) => {
    all.push({ type: m.type, at: Date.now() - t0, ...(m.type === 'room.state' ? { layout: m.layout } : {}) })
    if (m.type === 'room.state') rooms.push({ layout: m.layout, slow: m.slow, at: Date.now() - t0 })
  })
  return { session, rooms, all }
}

describe('ScriptedLiveSession room state', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('starts as a conversation, shows a brief slow spell in it, and goes to work when the problem appears', () => {
    const { session, rooms, all } = setup()
    session.send({ type: 'workspace.hello', has_content: false })
    vi.advanceTimersByTime(60_000)

    expect(rooms.map(({ layout, slow }) => [layout, slow])).toEqual([
      ['talk', false],
      ['talk', true],
      ['talk', false],
      ['work', false],
    ])
    const [start, slowOn, slowOff, work] = rooms
    expect(start.at).toBe(0)
    // slow lasts a moment, inside the first minute, while the room is still a conversation
    expect(slowOff.at - slowOn.at).toBeGreaterThan(0)
    expect(slowOff.at - slowOn.at).toBeLessThanOrEqual(3000)
    expect(slowOff.at).toBeLessThan(60_000)
    expect(slowOff.at).toBeLessThanOrEqual(work.at)
    // the problem keeps its time (3.1 s in) and is shown only after the room has opened for it
    const problem = all.findIndex((m) => m.type === 'panel.show_problem')
    expect(all[problem].at).toBe(3100)
    expect(work.at).toBeLessThanOrEqual(all[problem].at)
    expect(all.findIndex((m) => m.type === 'room.state' && m.layout === 'work')).toBeLessThan(problem)
  })

  it('goes back to a conversation for the closing, before the goodbye ends the round', () => {
    const { session, rooms, all } = setup(0)
    session.send({ type: 'workspace.hello', has_content: false })
    vi.runAllTimers()
    const before = rooms.length
    session.send({ type: 'session.end_request' })
    vi.runAllTimers()

    expect(rooms.slice(before).map(({ layout, slow }) => [layout, slow])).toEqual([['talk', false]])
    const types = all.map((m) => m.type)
    expect(types.lastIndexOf('room.state')).toBeLessThan(types.indexOf('session.ending'))
  })

  it('repeats the current state after a later hello, as the real agent does', () => {
    const { session, rooms } = setup(0)
    session.send({ type: 'workspace.hello', has_content: false })
    vi.runAllTimers()
    const played = rooms.length
    expect(rooms.at(-1)).toMatchObject({ layout: 'work', slow: false })
    session.send({ type: 'workspace.hello', has_content: true })
    expect(rooms).toHaveLength(played + 1)
    expect(rooms.at(-1)).toMatchObject({ layout: 'work', slow: false })
  })
})

describe('ScriptedLiveSession integrity', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('ends the round at once, saying why, after a foreign paste', () => {
    const session = new ScriptedLiveSession({ speed: 1 })
    const endings: Extract<AgentMessage, { type: 'session.ending' }>[] = []
    session.onMessage((m) => { if (m.type === 'session.ending') endings.push(m) })
    session.send({
      type: 'proctor.event', kind: 'foreign_paste', weight: 1, at: 1,
      counts: { tab_changes: 0, screen_changes: 0, full_violations: 0 },
      source: 'paste', chars: 80, lines: 4, clipboard_cleared: true,
    })
    vi.advanceTimersByTime(2000)
    expect(endings).toHaveLength(1)
    expect(endings[0]).toMatchObject({ reason: 'ended_by_interviewer' })
    expect(endings[0].message).toMatch(/pasted/i)
  })
})
