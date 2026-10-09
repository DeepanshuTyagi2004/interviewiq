'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProctorKind } from '../protocol/messages'
import type { LiveSession } from '../session/types'
import { EMPTY_LEDGER, MERGE_WINDOW_MS, recordEvent, type Ledger } from './ledger'
import { isPrompting, useScreenShared } from './screenShare'
import { useExternalDisplay } from './useExternalDisplay'
import { useFullscreen } from './useFullscreen'
import { useVisibility } from './useVisibility'

export const TOAST_MS = 4000
export const WARNING_TEXT = "Don't change screens while the interview is running."

export interface ProctorState {
  ledger: Ledger
  outOfFullscreen: boolean
  shareStopped: boolean
  toast: string | null
}

interface Signals {
  fullscreen: boolean
  hidden: boolean
  blurred: boolean
  /** null until the browser has said; a display that is already there at that point is a baseline, not an event. */
  extended: boolean | null
  shared: boolean
}

/** Watches tab visibility, window focus, full screen, a second display and the screen share (spec
 * §7). One action's signals merge into one weighted ledger entry: the warning toast shows at once,
 * and the merged event goes to the interviewer when the merge window closes. Never pauses the round. */
export function useProctor({ session, enabled }: { session: LiveSession; enabled: boolean }): ProctorState {
  const { isFullscreen } = useFullscreen()
  const { hidden } = useVisibility()
  const { extended } = useExternalDisplay()
  const shared = useScreenShared()
  const [blurred, setBlurred] = useState(false)
  const [ledger, setLedger] = useState<Ledger>(EMPTY_LEDGER)
  const [toast, setToast] = useState<string | null>(null)
  const ledgerRef = useRef(ledger)
  const prev = useRef<Signals | null>(null)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const onBlur = () => { if (!isPrompting()) setBlurred(true) }
    const onFocus = () => setBlurred(false)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  useEffect(() => {
    const pending = timers.current
    return () => { pending.forEach(clearTimeout); pending.clear() }
  }, [])

  const later = useCallback((ms: number, fn: () => void) => {
    const t = setTimeout(() => { timers.current.delete(t); fn() }, ms)
    timers.current.add(t)
  }, [])

  const record = useCallback((kind: ProctorKind) => {
    const { ledger: next, change } = recordEvent(ledgerRef.current, kind, Date.now())
    if (change.kind === 'merged') return
    ledgerRef.current = next
    setLedger(next)
    if (change.kind !== 'added') return
    setToast(WARNING_TEXT)
    later(TOAST_MS, () => setToast(null))
    const index = next.entries.length - 1
    later(MERGE_WINDOW_MS, () => {
      const l = ledgerRef.current
      const entry = l.entries[index]
      if (!entry) return
      session.send({
        type: 'proctor.event', kind: entry.kind, weight: entry.weight, at: entry.at,
        counts: { tab_changes: l.tabChanges, screen_changes: l.screenChanges, full_violations: l.fullViolations },
      })
    })
  }, [later, session])

  useEffect(() => {
    if (!enabled) {
      prev.current = null
      return
    }
    const now: Signals = { fullscreen: isFullscreen, hidden, blurred, extended, shared }
    const was = prev.current
    prev.current = now
    // On the first run an already-bad state counts, so entering out of full screen isn't a bypass.
    if ((was === null || was.fullscreen) && !now.fullscreen) record('fullscreen_exit')
    if ((was === null || !was.hidden) && now.hidden) record('tab_hidden')
    if ((was === null || !was.blurred) && now.blurred && !now.hidden) record('window_blur')
    // Only a display that appears after the round began counts: one already connected was warned about at the checks.
    if (was !== null && was.extended === false && now.extended === true) record('external_display')
    if (was !== null && was.shared && !now.shared) record('share_stopped')
  }, [enabled, isFullscreen, hidden, blurred, extended, shared, record])

  return {
    ledger,
    outOfFullscreen: enabled && !isFullscreen,
    shareStopped: enabled && !shared,
    toast,
  }
}
