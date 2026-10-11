'use client'
import { useEffect, useRef } from 'react'
import { warmLive } from '@/features/interview/api'
import { isMockMode } from './mockMode'

/** While the instructions page is open the interviewer is got ready in the background (spec 2026-10-11): one call per mount,
 * best effort. Entering the room works the same whether or not this call was made or succeeded. */
export function useWarmInterviewer(sessionId: string, enabled: boolean): void {
  const fired = useRef(false)
  useEffect(() => {
    if (!enabled || fired.current || isMockMode()) return
    fired.current = true
    void warmLive(sessionId).catch(() => {})
  }, [enabled, sessionId])
}
