'use client'
import { useEffect, useRef } from 'react'
import { MonoPill } from '@/components/patterns'
import { Button } from '@/components/ui/button'
import type { LiveSession } from '../session/types'

interface ViolationOverlayProps {
  session: LiveSession
  onReturn: () => void
}

/** Full-screen blocking overlay shown while the machine is `paused` for a proctoring violation
 * (fullscreen exit / tab hidden). The work area behind it is inert while this is up.
 *
 * Tamper resistance: a MutationObserver watches the overlay's parent for the overlay node being
 * removed from the DOM (e.g. via DevTools) and re-inserts it, reporting an `overlay_tamper` event
 * so the backend knows an attempt was made. This is deterrence only, not a real security boundary —
 * a determined user can still defeat any client-side overlay (disable JS, patch the observer, etc).
 * The actual guarantee has to come from the server refusing to progress the interview while it
 * believes the candidate is paused. */
export function ViolationOverlay({ session, onReturn }: ViolationOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const returnButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const node = overlayRef.current
    const parent = node?.parentElement
    if (!node || !parent) return

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (Array.from(mutation.removedNodes).includes(node)) {
          parent.appendChild(node)
          session.sendProctorEvent({ type: 'overlay_tamper', at: performance.now() })
        }
      }
    })
    observer.observe(parent, { childList: true })

    return () => observer.disconnect()
  }, [session])

  // Keep keyboard users on the recovery action: move focus to the Return button as soon as the
  // overlay mounts. A DOM call, not setState, so it's fine to run in the effect body directly.
  useEffect(() => {
    returnButtonRef.current?.focus()
  }, [])

  return (
    <div
      ref={overlayRef}
      data-testid="violation-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="violation-title"
      aria-describedby="violation-detail"
      className="fixed inset-0 z-[70] grid place-items-center bg-frame/80 p-4 backdrop-blur-md"
    >
      <div className="flex w-full max-w-[440px] flex-col items-center gap-4 rounded-[12px] border border-line-2 bg-card p-7 text-center shadow-hero sm:p-8">
        <MonoPill tone="alert">Round paused</MonoPill>
        <p
          id="violation-title"
          className="m-0 text-[22px] font-normal leading-[1.2] tracking-[-0.03em]"
          aria-live="assertive"
        >
          Please return to full-screen to continue
        </p>
        <p id="violation-detail" className="m-0 text-[13.5px] leading-[1.5] text-muted-foreground">
          Leaving full screen or switching tabs pauses the interview, and each pause is logged.
        </p>
        <Button ref={returnButtonRef} onClick={onReturn} className="mt-1 h-11 w-full text-[14px]">
          Return to full-screen
        </Button>
      </div>
    </div>
  )
}
