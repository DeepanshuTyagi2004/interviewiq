import { describe, it, expect } from 'vitest'
import { initialMachine, transition, type LiveState, type LiveContext } from './machine'

it('happy path prejoin → checks → connecting → live', () => {
  let s: { state: LiveState; ctx: LiveContext } = initialMachine()
  expect(s.state).toBe('prejoin')
  ;(s = transition(s.state, s.ctx, { type: 'START_CHECKS' })); expect(s.state).toBe('checks')
  ;(s = transition(s.state, s.ctx, { type: 'CHECKS_PASSED' })); expect(s.state).toBe('connecting')
  ;(s = transition(s.state, s.ctx, { type: 'CONNECTED' })); expect(s.state).toBe('live')
})
it('pause/resume from live counts a violation', () => {
  let s: { state: LiveState; ctx: LiveContext } = { state: 'live', ctx: { pausedReason: null, endedReason: null, violations: 0 } }
  s = transition(s.state, s.ctx, { type: 'PAUSE', reason: 'fullscreen_exit' })
  expect(s.state).toBe('paused'); expect(s.ctx.violations).toBe(1); expect(s.ctx.pausedReason).toBe('fullscreen_exit')
  s = transition(s.state, s.ctx, { type: 'RESUME' }); expect(s.state).toBe('live'); expect(s.ctx.pausedReason).toBeNull()
})
it('END from live → ending → ended; ENDED sets reason', () => {
  let s = transition('live', { pausedReason: null, endedReason: null, violations: 0 }, { type: 'END' })
  expect(s.state).toBe('ending')
  s = transition(s.state, s.ctx, { type: 'ENDED' }); expect(s.state).toBe('ended')
})
it('ignores illegal transitions (CONNECTED while prejoin stays prejoin)', () => {
  const s = transition('prejoin', { pausedReason: null, endedReason: null, violations: 0 }, { type: 'CONNECTED' })
  expect(s.state).toBe('prejoin')
})
it('checks_failed returns to prejoin', () => {
  const s = transition('checks', { pausedReason: null, endedReason: null, violations: 0 }, { type: 'CHECKS_FAILED' })
  expect(s.state).toBe('prejoin')
})
