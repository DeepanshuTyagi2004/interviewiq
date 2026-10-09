/**
 * Chromium's Keyboard Lock API: while the room is full screen, Esc must be held to leave it, so a
 * stray tap isn't a violation (spec §7). Does nothing in browsers without it.
 */
type KeyboardLock = { lock?: (codes?: string[]) => Promise<void>; unlock?: () => void }

function keyboard(): KeyboardLock | undefined {
  return typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard
}

export async function lockEscape(): Promise<boolean> {
  const kb = keyboard()
  if (!kb?.lock) return false
  try {
    await kb.lock(['Escape'])
    return true
  } catch {
    return false
  }
}

export function unlockKeys(): void {
  try {
    keyboard()?.unlock?.()
  } catch {
    // not supported
  }
}

/** Full screen, then the Esc lock (it only holds while the page is full screen). */
export async function enterFullscreen(): Promise<void> {
  await document.documentElement.requestFullscreen()
  await lockEscape()
}
