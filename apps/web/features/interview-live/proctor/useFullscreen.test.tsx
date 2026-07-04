import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useFullscreen } from './useFullscreen'

describe('useFullscreen', () => {
  beforeEach(() => {
    // vitest.setup.ts stubs fullscreenElement as a mutable property shared across
    // tests in this file; reset it so each test starts from a known non-fullscreen state.
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, writable: true, value: null })
  })

  it('starts with isFullscreen=false', () => {
    const { result } = renderHook(() => useFullscreen())
    expect(result.current.isFullscreen).toBe(false)
  })

  it('flips isFullscreen=true after request() and a fullscreenchange event', async () => {
    const { result } = renderHook(() => useFullscreen())

    await act(async () => {
      await result.current.request()
      document.dispatchEvent(new Event('fullscreenchange'))
    })

    expect(result.current.isFullscreen).toBe(true)
  })

  it('flips isFullscreen=false after exit() and a fullscreenchange event', async () => {
    const { result } = renderHook(() => useFullscreen())

    await act(async () => {
      await result.current.request()
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    expect(result.current.isFullscreen).toBe(true)

    await act(async () => {
      await result.current.exit()
      document.dispatchEvent(new Event('fullscreenchange'))
    })

    expect(result.current.isFullscreen).toBe(false)
  })

  it('requests fullscreen on the given ref element when provided', async () => {
    const el = document.createElement('div')
    el.requestFullscreen = document.documentElement.requestFullscreen.bind(el) as typeof el.requestFullscreen
    const ref = { current: el }

    const { result } = renderHook(() => useFullscreen(ref))

    await act(async () => {
      await result.current.request()
      document.dispatchEvent(new Event('fullscreenchange'))
    })

    expect(document.fullscreenElement).toBe(el)
    expect(result.current.isFullscreen).toBe(true)
  })

  it('removes the fullscreenchange listener on unmount', () => {
    const addSpy = vi.spyOn(document, 'addEventListener')
    const removeSpy = vi.spyOn(document, 'removeEventListener')

    const { unmount } = renderHook(() => useFullscreen())
    unmount()

    expect(addSpy).toHaveBeenCalledWith('fullscreenchange', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('fullscreenchange', expect.any(Function))

    addSpy.mockRestore()
    removeSpy.mockRestore()
  })
})
