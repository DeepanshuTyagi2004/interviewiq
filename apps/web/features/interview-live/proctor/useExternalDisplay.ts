'use client'
import { useEffect, useState } from 'react'

export function useExternalDisplay() {
  const [extended, setExtended] = useState<boolean | null>(null)
  const [supported, setSupported] = useState(false)

  useEffect(() => {
    const scr = window.screen as Screen & { isExtended?: boolean }
    if (typeof scr.isExtended === 'boolean') {
      setSupported(true)
      setExtended(scr.isExtended)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } else if (typeof (window as any).getScreenDetails === 'function') {
      setSupported(true)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(window as any)
        .getScreenDetails()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .then((d: any) => setExtended((d?.screens?.length ?? 1) > 1))
        .catch(() => setExtended(null))
    } else {
      setSupported(false)
      setExtended(null)
    }
  }, [])

  return { extended, supported }
}
