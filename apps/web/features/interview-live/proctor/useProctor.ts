'use client'
import { useEffect, useRef } from 'react'
import { useFullscreen } from './useFullscreen'
import { useVisibility } from './useVisibility'
import { useLiveSession } from '../session/useLiveSession'
import type { LiveSession, ProctorEvent } from '../session/types'

interface UseProctorParams {
  session: LiveSession
  enabled: boolean
  onViolation: (e: ProctorEvent) => void
}

interface UseProctorResult {
  violations: number
  active: boolean
}

/** Aggregates fullscreen + tab-visibility proctoring signals into ProctorEvents. Emits on actual
 * transitions only (never on mount), reports each to the session, and notifies the caller. The
 * violation *count* is not tracked here — the live-session state machine is the single source of
 * truth (it increments on PAUSE, which MockLiveSession/LiveKitLiveSession echo back from these
 * very events), so this hook only reads `ctx.violations` rather than duplicating the counter. */
export function useProctor({ session, enabled, onViolation }: UseProctorParams): UseProctorResult {
  const { isFullscreen } = useFullscreen()
  const { hidden } = useVisibility()
  const { ctx } = useLiveSession()

  const prevFullscreen = useRef(isFullscreen)
  const prevHidden = useRef(hidden)
  const mounted = useRef(false)

  useEffect(() => {
    // Skip the initial mount: it just establishes the baseline, not a real transition.
    if (!mounted.current) {
      mounted.current = true
      prevFullscreen.current = isFullscreen
      prevHidden.current = hidden
      return
    }

    if (isFullscreen !== prevFullscreen.current) {
      if (enabled) {
        const event: ProctorEvent = {
          type: isFullscreen ? 'fullscreen_restored' : 'fullscreen_exit',
          at: performance.now(),
        }
        session.sendProctorEvent(event)
        onViolation(event)
      }
      prevFullscreen.current = isFullscreen
    }

    if (hidden !== prevHidden.current) {
      if (enabled) {
        const event: ProctorEvent = { type: hidden ? 'tab_hidden' : 'tab_visible', at: performance.now() }
        session.sendProctorEvent(event)
        onViolation(event)
      }
      prevHidden.current = hidden
    }
  }, [isFullscreen, hidden, enabled, session, onViolation])

  return { violations: ctx.violations, active: !isFullscreen || hidden }
}
