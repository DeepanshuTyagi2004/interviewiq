'use client'
import { useEffect, useRef, useState } from 'react'
import type { AgentState } from './types'

export const ABSENT_NOTICE_MS = 10_000
export const NUDGE_EVERY_MS = 30_000

export type Presence = 'present' | 'joining' | 'reconnecting'

/** Spec §11: after 10 s without the interviewer the room says so, and every 30 s it nudges the API
 * (GET live), which re-dispatches the interviewer when the room is empty. */
export function useInterviewerPresence(agentState: AgentState, sessionId: string, nudge: (id: string) => Promise<unknown>): Presence {
  const [notice, setNotice] = useState<Exclude<Presence, 'present'> | null>(null)
  const seen = useRef(false)
  const absent = agentState === 'absent'

  useEffect(() => {
    if (!absent) {
      seen.current = true
      return
    }
    const kind = seen.current ? 'reconnecting' : 'joining'
    const show = setTimeout(() => setNotice(kind), ABSENT_NOTICE_MS)
    const poke = setInterval(() => { void nudge(sessionId).catch(() => {}) }, NUDGE_EVERY_MS)
    return () => {
      clearTimeout(show)
      clearInterval(poke)
      setNotice(null)
    }
  }, [absent, sessionId, nudge])

  return absent && notice ? notice : 'present'
}
