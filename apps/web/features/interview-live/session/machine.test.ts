import { describe, expect, it } from 'vitest'
import { initialMachine, transition, type LiveEvent, type LiveState } from './machine'

function run(events: LiveEvent[], from = initialMachine()) {
  return events.reduce((s, e) => transition(s.state, s.ctx, e), from)
}
const at = (state: LiveState) => ({ state, ctx: initialMachine().ctx })

describe('live machine', () => {
  it('walks prejoin → checks → connecting → live → ending → ended', () => {
    const s = run([{ type: 'START_CHECKS' }, { type: 'CHECKS_PASSED' }, { type: 'CONNECTED' }, { type: 'END' }, { type: 'ENDED', reason: 'candidate_ended' }])
    expect(s.state).toBe('ended')
    expect(s.ctx).toEqual({ endedReason: 'candidate_ended', endedMessage: null })
  })

  it('ends straight from live with the interviewer reason and message', () => {
    const s = run([{ type: 'ENDED', reason: 'ended_by_interviewer', message: 'Repeated tab switching.' }], at('live'))
    expect(s.ctx).toEqual({ endedReason: 'ended_by_interviewer', endedMessage: 'Repeated tab switching.' })
  })

  it('returns to live after reconnecting and can end from there', () => {
    expect(run([{ type: 'RECONNECTING' }, { type: 'RECONNECTED' }], at('live')).state).toBe('live')
    expect(run([{ type: 'RECONNECTING' }, { type: 'ENDED', reason: 'technical' }], at('live')).state).toBe('ended')
  })

  it('ignores ENDED while connecting: a failed connect surfaces as ERROR', () => {
    expect(run([{ type: 'ENDED', reason: 'technical' }], at('connecting')).state).toBe('connecting')
    expect(run([{ type: 'ERROR' }], at('connecting')).state).toBe('error')
  })

  it('keeps the first ending: later ENDED and ERROR do not change an ended round', () => {
    const ended = run([{ type: 'ENDED', reason: 'completed' }], at('live'))
    expect(run([{ type: 'ENDED', reason: 'technical' }, { type: 'ERROR' }], ended)).toEqual(ended)
  })

  it('ignores illegal events', () => {
    expect(run([{ type: 'CONNECTED' }]).state).toBe('prejoin')
  })
})
