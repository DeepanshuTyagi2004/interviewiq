'use client'
import { useEffect, useRef } from 'react'
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
      className="fixed inset-0 z-[70] backdrop-blur-md bg-background/80 grid place-items-center"
    >
      <div className="flex flex-col items-center gap-4 rounded-lg border bg-card p-8 text-center shadow-lg">
        <p className="text-lg font-medium" aria-live="assertive">
          Please return to full-screen to continue
        </p>
        <Button ref={returnButtonRef} onClick={onReturn}>
          Return to full-screen
        </Button>
      </div>
    </div>
  )
}
