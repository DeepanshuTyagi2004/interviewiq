import type { Speaker } from './types'

export type LiveState = 'prejoin' | 'checks' | 'connecting' | 'live' | 'paused' | 'ending' | 'ended' | 'error'
export type LiveEvent =
  | { type: 'START_CHECKS' } | { type: 'CHECKS_PASSED' } | { type: 'CHECKS_FAILED' }
  | { type: 'CONNECTED' } | { type: 'PAUSE'; reason: string } | { type: 'RESUME' }
  | { type: 'END' } | { type: 'ENDED' } | { type: 'ERROR' }
export interface LiveContext { pausedReason: string | null; endedReason: string | null; violations: number }

export function initialMachine(): { state: LiveState; ctx: LiveContext } {
  return { state: 'prejoin', ctx: { pausedReason: null, endedReason: null, violations: 0 } }
}

export function transition(state: LiveState, ctx: LiveContext, event: LiveEvent): { state: LiveState; ctx: LiveContext } {
  // ERROR is always reachable
  if (event.type === 'ERROR') return { state: 'error', ctx }
  switch (state) {
    case 'prejoin':
      if (event.type === 'START_CHECKS') return { state: 'checks', ctx }
      break
    case 'checks':
      if (event.type === 'CHECKS_PASSED') return { state: 'connecting', ctx }
      if (event.type === 'CHECKS_FAILED') return { state: 'prejoin', ctx }
      break
    case 'connecting':
      if (event.type === 'CONNECTED') return { state: 'live', ctx }
      break
    case 'live':
      if (event.type === 'PAUSE') return { state: 'paused', ctx: { ...ctx, pausedReason: event.reason, violations: ctx.violations + 1 } }
      if (event.type === 'END') return { state: 'ending', ctx }
      if (event.type === 'ENDED') return { state: 'ended', ctx }
      break
    case 'paused':
      if (event.type === 'RESUME') return { state: 'live', ctx: { ...ctx, pausedReason: null } }
      if (event.type === 'END') return { state: 'ending', ctx }
      if (event.type === 'ENDED') return { state: 'ended', ctx }
      break
    case 'ending':
      if (event.type === 'ENDED') return { state: 'ended', ctx: { ...ctx, endedReason: ctx.endedReason ?? 'completed' } }
      break
  }
  return { state, ctx }   // illegal transition → no-op
}
