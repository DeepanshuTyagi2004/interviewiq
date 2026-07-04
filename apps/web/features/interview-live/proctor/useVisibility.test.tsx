import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useVisibility } from './useVisibility'

function setDocumentHidden(value: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, value })
}

describe('useVisibility', () => {
  afterEach(() => {
    setDocumentHidden(false)
  })

  it('starts with hidden=false when document.hidden is false', () => {
    setDocumentHidden(false)
    const { result } = renderHook(() => useVisibility())
    expect(result.current.hidden).toBe(false)
  })

  it('flips hidden=true after document.hidden=true and a visibilitychange event', () => {
    setDocumentHidden(false)
    const { result } = renderHook(() => useVisibility())

    act(() => {
      setDocumentHidden(true)
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(result.current.hidden).toBe(true)
  })

  it('flips hidden=false again after document.hidden=false and a visibilitychange event', () => {
    setDocumentHidden(true)
    const { result } = renderHook(() => useVisibility())
    expect(result.current.hidden).toBe(true)

    act(() => {
      setDocumentHidden(false)
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(result.current.hidden).toBe(false)
  })

  it('removes the visibilitychange listener on unmount', () => {
    const addSpy = vi.spyOn(document, 'addEventListener')
    const removeSpy = vi.spyOn(document, 'removeEventListener')

    const { unmount } = renderHook(() => useVisibility())
    unmount()

    expect(addSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))

    addSpy.mockRestore()
    removeSpy.mockRestore()
  })
})
