import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useExternalDisplay } from './useExternalDisplay'

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
