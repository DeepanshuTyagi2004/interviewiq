import type { EndReason } from '../protocol/messages'

export type LiveState = 'prejoin' | 'checks' | 'connecting' | 'live' | 'reconnecting' | 'ending' | 'ended' | 'error'
export type LiveEvent =
  | { type: 'START_CHECKS' } | { type: 'CHECKS_PASSED' } | { type: 'CHECKS_FAILED' }
  | { type: 'CONNECTED' } | { type: 'RECONNECTING' } | { type: 'RECONNECTED' }
  | { type: 'END' } | { type: 'ENDED'; reason: EndReason; message?: string } | { type: 'ERROR' }
export interface LiveContext { endedReason: EndReason | null; endedMessage: string | null }

export function initialMachine(): { state: LiveState; ctx: LiveContext } {
  return { state: 'prejoin', ctx: { endedReason: null, endedMessage: null } }
}

/** The round never pauses (spec §7): proctoring counts and warns while the interview keeps running. */
export function transition(state: LiveState, ctx: LiveContext, event: LiveEvent): { state: LiveState; ctx: LiveContext } {
  if (state === 'ended') return { state, ctx }
  if (event.type === 'ERROR') return { state: 'error', ctx }
  const end = (e: Extract<LiveEvent, { type: 'ENDED' }>) => ({
    state: 'ended' as const,
    ctx: { endedReason: e.reason, endedMessage: e.message ?? null },
  })
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
      if (event.type === 'RECONNECTING') return { state: 'reconnecting', ctx }
      if (event.type === 'END') return { state: 'ending', ctx }
      if (event.type === 'ENDED') return end(event)
      break
    case 'reconnecting':
      if (event.type === 'RECONNECTED') return { state: 'live', ctx }
      if (event.type === 'END') return { state: 'ending', ctx }
      if (event.type === 'ENDED') return end(event)
      break
    case 'ending':
      if (event.type === 'ENDED') return end(event)
      break
  }
  return { state, ctx }
}
