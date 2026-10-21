import { describe, expect, it } from 'vitest'
import { AWAY_CAP_S, AWAY_LIMIT_SCREEN_S, AWAY_LIMIT_TAB_S, awayKinds, countdown, limitSeconds, nextEpisode, type AwayEpisode } from './awayEpisode'

const here = { fullscreen: true, hidden: false, blurred: false, shareLost: false }

describe('awayKinds', () => {
  it('is empty while the candidate is on the screen', () => {
    expect(awayKinds(here)).toEqual([])
  })

  it('lists every active signal in a fixed order', () => {
    expect(awayKinds({ fullscreen: false, hidden: true, blurred: false, shareLost: true })).toEqual(['tab_hidden', 'fullscreen_exit', 'share_stopped'])
  })

  it('does not count the window blur a hidden tab always causes', () => {
    expect(awayKinds({ ...here, hidden: true, blurred: true })).toEqual(['tab_hidden'])
    expect(awayKinds({ ...here, blurred: true })).toEqual(['window_blur'])
  })
})

describe('nextEpisode', () => {
  it('starts an episode at the first signal; leaving only full screen has the looser limit', () => {
    const { episode, change } = nextEpisode(null, ['fullscreen_exit'], 1000)
    expect(episode).toEqual({ startedAt: 1000, kinds: ['fullscreen_exit'], tight: false })
    expect(change).toEqual({ type: 'start', episode })
    expect(limitSeconds(episode!)).toBe(AWAY_LIMIT_SCREEN_S)
  })

  it('leaving the tab or the window has the strict limit', () => {
    expect(nextEpisode(null, ['tab_hidden'], 1000).episode).toMatchObject({ tight: true })
    expect(limitSeconds({ tight: true })).toBe(AWAY_LIMIT_TAB_S)
    expect(nextEpisode(null, ['window_blur'], 1000).episode).toMatchObject({ tight: true })
  })

  it('reports nothing while the set of signals is unchanged', () => {
    const prev: AwayEpisode = { startedAt: 1000, kinds: ['fullscreen_exit'], tight: false }
    const next = nextEpisode(prev, ['fullscreen_exit'], 5000)
    expect(next.episode).toBe(prev)
    expect(next.change).toBeNull()
  })

  it('reports a changed set, keeps the start, and latches the strict limit even after the tab is back', () => {
    const prev: AwayEpisode = { startedAt: 1000, kinds: ['fullscreen_exit'], tight: false }
    const joined = nextEpisode(prev, ['tab_hidden', 'fullscreen_exit'], 4000)
    expect(joined.episode).toEqual({ startedAt: 1000, kinds: ['tab_hidden', 'fullscreen_exit'], tight: true })
    expect(joined.change).toEqual({ type: 'update', episode: joined.episode })
    const left = nextEpisode(joined.episode, ['fullscreen_exit'], 6000)
    expect(left.episode).toEqual({ startedAt: 1000, kinds: ['fullscreen_exit'], tight: true })
  })

  it('ends the episode when everything is back and says whether it ran past the limit', () => {
    const screen: AwayEpisode = { startedAt: 0, kinds: ['fullscreen_exit'], tight: false }
    expect(nextEpisode(screen, [], 4_000)).toEqual({ episode: null, change: { type: 'back', awayMs: 4_000, overLimit: false, limitS: 5 } })
    expect(nextEpisode(screen, [], 5_000).change).toMatchObject({ overLimit: true })
    const tab: AwayEpisode = { startedAt: 0, kinds: ['tab_hidden'], tight: true }
    expect(nextEpisode(tab, [], 5_000).change).toMatchObject({ overLimit: true, limitS: AWAY_LIMIT_TAB_S })
    expect(nextEpisode(tab, [], 4_999).change).toMatchObject({ overLimit: false })
  })

  it('has nothing to say when there was no episode and there is none', () => {
    expect(nextEpisode(null, [], 1000)).toEqual({ episode: null, change: null })
  })
})

describe('countdown', () => {
  const tab: AwayEpisode = { startedAt: 10_000, kinds: ['tab_hidden'], tight: true }

  it('counts down to the limit, rounding up', () => {
    expect(countdown(tab, 10_000)).toEqual({ phase: 'limit', seconds: AWAY_LIMIT_TAB_S })
    expect(countdown(tab, 10_001)).toEqual({ phase: 'limit', seconds: AWAY_LIMIT_TAB_S })
    expect(countdown(tab, 14_500)).toEqual({ phase: 'limit', seconds: 1 })
  })

  it('then counts down to the cap, and never below zero', () => {
    expect(countdown(tab, 15_000)).toEqual({ phase: 'cap', seconds: AWAY_CAP_S - AWAY_LIMIT_TAB_S })
    expect(countdown(tab, 20_000)).toEqual({ phase: 'cap', seconds: 0 })
    expect(countdown(tab, 500_000)).toEqual({ phase: 'cap', seconds: 0 })
  })

  it('treats a clock reading from before the episode as its start', () => {
    expect(countdown(tab, 2_000)).toEqual({ phase: 'limit', seconds: AWAY_LIMIT_TAB_S })
  })
})
