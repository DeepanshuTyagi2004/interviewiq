'use client'
import { useEffect, useRef, useState } from 'react'
import { useFullscreen } from './useFullscreen'
import { useVisibility } from './useVisibility'
import { useExternalDisplay } from './useExternalDisplay'
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

/** Aggregates fullscreen + tab-visibility + window-focus + external-display proctoring signals
 * into ProctorEvents. Emits on actual transitions only (except for the already-violating-on-enable
 * case below), reports each to the session, and notifies the caller. The violation *count* is not
 * tracked here — the live-session state machine is the single source of truth (it increments on
 * PAUSE, which MockLiveSession/LiveKitLiveSession echo back from these very events), so this hook
 * only reads `ctx.violations` rather than duplicating the counter.
 *
 * `window.blur`/`focus` (OS-level focus loss, e.g. Alt-Tab) is folded into a single
 * `awayFromWindow = hidden || windowBlurred` boolean together with document.visibilitychange —
 * a normal tab-switch fires BOTH, so without this dedupe it would count as two violations. */
export function useProctor({ session, enabled, onViolation }: UseProctorParams): UseProctorResult {
  const { isFullscreen } = useFullscreen()
  const { hidden } = useVisibility()
  const { extended } = useExternalDisplay()
  const { ctx } = useLiveSession()

  // OS-level window-focus loss. There's no safe synchronous "is this window currently focused"
  // read at mount that avoids an SSR/hydration mismatch, and blur is additive to the existing
  // fullscreen/visibility signals rather than a baseline concern, so this defaults to false.
  const [windowBlurred, setWindowBlurred] = useState(false)
  useEffect(() => {
    const onBlur = () => setWindowBlurred(true)
    const onFocus = () => setWindowBlurred(false)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  const awayFromWindow = hidden || windowBlurred

  const prevFullscreen = useRef(isFullscreen)
  const prevAway = useRef(awayFromWindow)
  const prevExtended = useRef(extended)
  const prevEnabled = useRef(enabled)
  const mounted = useRef(false)

  useEffect(() => {
    function emit(event: ProctorEvent) {
      session.sendProctorEvent(event)
      onViolation(event)
    }

    if (!mounted.current) {
      // First run just establishes the baseline for the *transition* logic below — BUT if
      // proctoring is already enabled and the CURRENT state is already a violation (out of
      // fullscreen, or away from the window), fire immediately instead of quietly adopting the
      // bad state as the baseline. Without this, entering `live`/`paused` already out of
      // fullscreen (or already tabbed away) is a silent client-side bypass (never pauses).
      mounted.current = true
      prevFullscreen.current = isFullscreen
      prevAway.current = awayFromWindow
      prevExtended.current = extended
      prevEnabled.current = enabled
      if (enabled) {
        if (!isFullscreen) emit({ type: 'fullscreen_exit', at: performance.now() })
        if (awayFromWindow) emit({ type: 'tab_hidden', at: performance.now() })
      }
      return
    }

    // Covers `enabled` flipping false -> true after mount (current callers all pass a constant
    // `enabled`, but the already-violating-on-enable guarantee should hold generally).
    if (enabled && !prevEnabled.current) {
      if (!isFullscreen) emit({ type: 'fullscreen_exit', at: performance.now() })
      if (awayFromWindow) emit({ type: 'tab_hidden', at: performance.now() })
    }
    prevEnabled.current = enabled

    if (isFullscreen !== prevFullscreen.current) {
      if (enabled) {
        emit({ type: isFullscreen ? 'fullscreen_restored' : 'fullscreen_exit', at: performance.now() })
      }
      prevFullscreen.current = isFullscreen
    }

    if (awayFromWindow !== prevAway.current) {
      if (enabled) {
        emit({ type: awayFromWindow ? 'tab_hidden' : 'tab_visible', at: performance.now() })
      }
      prevAway.current = awayFromWindow
    }

    // External display has no "restored" counterpart in ProctorEvent — only the rising edge
    // (extended becoming true) is reported, best-effort, where the Window Management API exists.
    if (extended && !prevExtended.current) {
      if (enabled) emit({ type: 'external_display_detected', at: performance.now() })
    }
    prevExtended.current = extended
  }, [isFullscreen, awayFromWindow, extended, enabled, session, onViolation])

  return { violations: ctx.violations, active: !isFullscreen || awayFromWindow }
}
