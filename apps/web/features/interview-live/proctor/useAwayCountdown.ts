'use client'
import { useEffect, useState } from 'react'
import { countdown, type AwayEpisode, type Countdown } from './awayEpisode'

export function countdownLabel(c: Countdown): string {
  return c.phase === 'limit' ? `⚠ Return in ${c.seconds} s` : `⚠ Interview ends in ${c.seconds} s`
}

/** Counts an away episode down once a second and shows the count in the tab title while it lasts: from another tab, the
 * title is the only thing of the room the candidate can see. */
export function useAwayCountdown(away: AwayEpisode | null): Countdown | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!away) return
    // Re-read the clock the moment an episode opens or changes, so the first frame is not a stale tick; the interval only covers later seconds.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now())
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [away])

  const current = away ? countdown(away, now) : null
  const label = current ? countdownLabel(current) : null
  useEffect(() => {
    if (!label) return
    const original = document.title
    document.title = label
    return () => {
      document.title = original
    }
  }, [label])
  return current
}
