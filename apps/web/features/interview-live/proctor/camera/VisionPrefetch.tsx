'use client'
import { useEffect } from 'react'
import { startVisionDownload } from './visionAssets'

/** Wait after a signed-in page loads, so the page's own requests go first. */
export const PREFETCH_DELAY_MS = 3000

/** Mounted in the signed-in shell: downloads the camera check's files in the background, once per device. */
export function VisionPrefetch() {
  useEffect(() => {
    const t = setTimeout(startVisionDownload, PREFETCH_DELAY_MS)
    return () => clearTimeout(t)
  }, [])
  return null
}
