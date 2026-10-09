'use client'
/**
 * The entire-screen share the room requires (spec §7). Acquired at the checks, kept active for the
 * round and checked, but never published to the room. Module state, so the checks and the live view
 * share one stream.
 */
import { useSyncExternalStore } from 'react'

export type ShareResult = { ok: true } | { ok: false; reason: 'denied' | 'not_entire_screen' | 'unsupported' }

let stream: MediaStream | null = null
let prompting = false
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function isScreenShared(): boolean {
  return stream !== null
}

/** True while the browser's share picker is open: the window blur it causes isn't a violation. */
export function isPrompting(): boolean {
  return prompting
}

export async function requestEntireScreen(): Promise<ShareResult> {
  const devices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices
  if (!devices?.getDisplayMedia) return { ok: false, reason: 'unsupported' }
  let next: MediaStream
  prompting = true
  try {
    next = await devices.getDisplayMedia({
      video: { displaySurface: 'monitor' },
      audio: false,
      monitorTypeSurfaces: 'include',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'exclude',
    } as DisplayMediaStreamOptions)
  } catch {
    return { ok: false, reason: 'denied' }
  } finally {
    prompting = false
  }
  const track = next.getVideoTracks()[0]
  const surface = (track?.getSettings() as { displaySurface?: string } | undefined)?.displaySurface
  // Browsers that don't report the surface are trusted; Chrome and Edge always report it.
  if (!track || (surface !== undefined && surface !== 'monitor')) {
    next.getTracks().forEach((t) => t.stop())
    return { ok: false, reason: 'not_entire_screen' }
  }
  stream?.getTracks().forEach((t) => t.stop())
  stream = next
  track.addEventListener('ended', () => {
    if (stream !== next) return
    stream = null
    notify()
  })
  notify()
  return { ok: true }
}

export function stopScreenShare(): void {
  if (!stream) return
  stream.getTracks().forEach((t) => t.stop())
  stream = null
  notify()
}

export function useScreenShared(): boolean {
  return useSyncExternalStore(subscribe, isScreenShared, () => false)
}
