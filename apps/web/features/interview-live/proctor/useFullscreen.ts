'use client'
import { useEffect, useState, type RefObject } from 'react'

interface UseFullscreenResult {
  isFullscreen: boolean
  request: () => Promise<void>
  exit: () => Promise<void>
}

export function useFullscreen(ref?: RefObject<HTMLElement | null>): UseFullscreenResult {
  const [isFullscreen, setIsFullscreen] = useState(
    () => typeof document !== 'undefined' && !!document.fullscreenElement,
  )

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  async function request() {
    await (ref?.current ?? document.documentElement).requestFullscreen()
  }

  async function exit() {
    await document.exitFullscreen()
  }

  return { isFullscreen, request, exit }
}
