/**
 * The return clock's browser half (live integrity spec §7): which away signals are active, where an episode starts and
 * ends, and what the candidate is told. The worker times the episode on its own clock and decides what it costs; this
 * only reports it and counts down.
 */
import type { AwayKind } from '../protocol/messages'

/** Away this long from the start of the episode, whatever the cause: back by now, or it counts as another violation (the final warning). The
 * worker (AWAY_FINAL_S in conductor.py) counts the same 5 s from the start of the episode (owner 2026-10-21; it was 4 s after the first warning). */
export const AWAY_LIMIT_TAB_S = 5
/** Leaving full screen or stopping the share, and nothing else: the same 5 s now. */
export const AWAY_LIMIT_SCREEN_S = 5
/** Away this long ends the interview, whatever the cause (AWAY_CAP_S in conductor.py: 7 s at most). */
export const AWAY_CAP_S = 7

export interface AwaySignals {
  fullscreen: boolean
  hidden: boolean
  blurred: boolean
  /** A share that was running has stopped; a room that never had one has not lost it. */
  shareLost: boolean
}

/** The away signals active right now, in a fixed order. A hidden tab always blurs the window too; that is one signal. */
export function awayKinds(s: AwaySignals): AwayKind[] {
  const kinds: AwayKind[] = []
  if (s.hidden) kinds.push('tab_hidden')
  if (s.blurred && !s.hidden) kinds.push('window_blur')
  if (!s.fullscreen) kinds.push('fullscreen_exit')
  if (s.shareLost) kinds.push('share_stopped')
  return kinds
}

export interface AwayEpisode {
  startedAt: number
  /** Every away signal active now. */
  kinds: AwayKind[]
  /** True once the tab or the window has been left at any point in the episode: the strict limit then applies. */
  tight: boolean
}

const leftTabOrWindow = (kinds: readonly AwayKind[]) => kinds.includes('tab_hidden') || kinds.includes('window_blur')

export function limitSeconds(episode: Pick<AwayEpisode, 'tight'>): number {
  return episode.tight ? AWAY_LIMIT_TAB_S : AWAY_LIMIT_SCREEN_S
}

export type AwayChange =
  | { type: 'start' | 'update'; episode: AwayEpisode }
  | { type: 'back'; awayMs: number; overLimit: boolean; limitS: number }

/** One step of the tracker: an episode starts at the first signal, updates when the set changes, and ends when it is empty. */
export function nextEpisode(prev: AwayEpisode | null, kinds: AwayKind[], now: number): { episode: AwayEpisode | null; change: AwayChange | null } {
  if (kinds.length === 0) {
    if (!prev) return { episode: null, change: null }
    const awayMs = now - prev.startedAt
    const limitS = limitSeconds(prev)
    return { episode: null, change: { type: 'back', awayMs, overLimit: awayMs >= limitS * 1000, limitS } }
  }
  if (!prev) {
    const episode: AwayEpisode = { startedAt: now, kinds, tight: leftTabOrWindow(kinds) }
    return { episode, change: { type: 'start', episode } }
  }
  if (prev.kinds.join() === kinds.join()) return { episode: prev, change: null }
  const episode: AwayEpisode = { ...prev, kinds, tight: prev.tight || leftTabOrWindow(kinds) }
  return { episode, change: { type: 'update', episode } }
}

export interface Countdown {
  /** `limit`: seconds left before it counts as another violation. `cap`: seconds left before the interview ends. */
  phase: 'limit' | 'cap'
  seconds: number
}

export function countdown(episode: AwayEpisode, now: number): Countdown {
  const elapsed = Math.max(0, (now - episode.startedAt) / 1000)
  const limit = limitSeconds(episode)
  if (elapsed < limit) return { phase: 'limit', seconds: Math.ceil(limit - elapsed) }
  return { phase: 'cap', seconds: Math.max(0, Math.ceil(AWAY_CAP_S - elapsed)) }
}
