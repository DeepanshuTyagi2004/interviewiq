import { afterEach, describe, expect, it, vi } from 'vitest'
import { enterFullscreen, lockEscape } from './keyboardLock'

afterEach(() => { Reflect.deleteProperty(navigator, 'keyboard') })

describe('keyboard lock', () => {
  it('locks Escape where the Keyboard Lock API exists', async () => {
    const lock = vi.fn(async () => {})
    Object.defineProperty(navigator, 'keyboard', { configurable: true, value: { lock, unlock: vi.fn() } })
    expect(await lockEscape()).toBe(true)
    expect(lock).toHaveBeenCalledWith(['Escape'])
  })

  it('does nothing elsewhere', async () => {
    expect(await lockEscape()).toBe(false)
  })

  it('enters full screen before locking', async () => {
    await enterFullscreen()
    expect(document.documentElement.requestFullscreen).toHaveBeenCalled()
  })
})
