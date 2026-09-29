'use client'
import { useEffect, useState } from 'react'

interface ExternalDisplayState {
  extended: boolean | null
  supported: boolean
}

export function useExternalDisplay() {
  const [state, setState] = useState<ExternalDisplayState>({ extended: null, supported: false })

  useEffect(() => {
    const scr = window.screen as Screen & { isExtended?: boolean }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anyWindow = window as any
    const isExtendedKnown = typeof scr.isExtended === 'boolean'
    const hasGetScreenDetails = typeof anyWindow.getScreenDetails === 'function'

    // Window-Management-API detection reads window.screen.isExtended / getScreenDetails,
    // which don't exist during SSR. A useState lazy initializer would freeze on the SSR
    // default on the client and cause a hydration mismatch, so this must run in an effect.
    // All synchronously-known results are folded into a single setState call here; only
    // the truly async getScreenDetails() resolution below sets state again, from its own
    // promise callback (not flagged by this rule).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({
      supported: isExtendedKnown || hasGetScreenDetails,
      extended: isExtendedKnown ? (scr.isExtended as boolean) : null,
    })

    if (!isExtendedKnown && hasGetScreenDetails) {
      anyWindow
        .getScreenDetails()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .then((d: any) => setState((prev) => ({ ...prev, extended: (d?.screens?.length ?? 1) > 1 })))
        .catch(() => setState((prev) => ({ ...prev, extended: null })))
    }
  }, [])

  return { extended: state.extended, supported: state.supported }
}
