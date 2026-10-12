import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { ProctorActionsProvider, useProctorActions } from './ProctorContext'

describe('useProctorActions', () => {
  it('is a harmless no-op outside the live room', () => {
    const { result } = renderHook(() => useProctorActions())
    expect(() => result.current.foreignPaste({ source: 'paste', chars: 1, lines: 1 })).not.toThrow()
  })

  it('hands the room its actions', () => {
    const foreignPaste = vi.fn()
    const { result } = renderHook(() => useProctorActions(), {
      wrapper: ({ children }) => <ProctorActionsProvider value={{ foreignPaste }}>{children}</ProctorActionsProvider>,
    })
    result.current.foreignPaste({ source: 'drop', chars: 5, lines: 1 })
    expect(foreignPaste).toHaveBeenCalledWith({ source: 'drop', chars: 5, lines: 1 })
  })
})
