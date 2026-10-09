import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useExternalDisplay, type ExtendedScreen } from './useExternalDisplay'

describe('useExternalDisplay', () => {
  it('returns supported:false and extended:null in jsdom (no Window Management API)', () => {
    const { result } = renderHook(() => useExternalDisplay())
    expect(result.current.supported).toBe(false)
    expect(result.current.extended).toBe(null)
  })

  it('does not throw when Window Management API is unavailable', () => {
    expect(() => {
      const { unmount } = renderHook(() => useExternalDisplay())
      unmount()
    }).not.toThrow()
  })
})

describe('useExternalDisplay changes', () => {
  it('follows the screen when a display is connected or removed after mount', () => {
    const scr = window.screen as ExtendedScreen
    let onChange: () => void = () => {}
    const original = { add: scr.addEventListener, remove: scr.removeEventListener }
    Object.defineProperty(scr, 'isExtended', { configurable: true, writable: true, value: false })
    scr.addEventListener = ((type: string, cb: () => void) => { if (type === 'change') onChange = cb }) as typeof scr.addEventListener
    scr.removeEventListener = (() => {}) as typeof scr.removeEventListener
    try {
      const { result } = renderHook(() => useExternalDisplay())
      expect(result.current.extended).toBe(false)
      act(() => { scr.isExtended = true; onChange() })
      expect(result.current.extended).toBe(true)
    } finally {
      scr.addEventListener = original.add
      scr.removeEventListener = original.remove
      Reflect.deleteProperty(scr, 'isExtended')
    }
  })
})
