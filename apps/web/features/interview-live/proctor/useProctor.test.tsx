import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { useProctor } from './useProctor'
import { LiveSessionProvider, useLiveSession } from '../session/LiveSessionProvider'
import { MockLiveSession } from '../session/MockLiveSession'
import type { ProctorEvent } from '../session/types'

function setDocumentHidden(value: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, value })
}

function setFullscreenElement(value: Element | null) {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, writable: true, value })
}

function renderProctor(session: MockLiveSession, enabled: boolean, onViolation: (e: ProctorEvent) => void) {
  function wrapper({ children }: { children: ReactNode }) {
    return <LiveSessionProvider sessionId="s1" session={session}>{children}</LiveSessionProvider>
  }
  return renderHook(
    () => {
      const { session: ctxSession } = useLiveSession()
      return useProctor({ session: ctxSession, enabled, onViolation })
    },
    { wrapper },
  )
}

describe('useProctor', () => {
  beforeEach(() => {
    setFullscreenElement(null)
    setDocumentHidden(false)
  })

  afterEach(() => {
    setFullscreenElement(null)
    setDocumentHidden(false)
  })

  it('does not emit any ProctorEvent on initial mount', () => {
    const session = new MockLiveSession()
    const spy = vi.spyOn(session, 'sendProctorEvent')
    const onViolation = vi.fn()

    renderProctor(session, true, onViolation)

    expect(spy).not.toHaveBeenCalled()
    expect(onViolation).not.toHaveBeenCalled()
  })

  it('emits fullscreen_exit when fullscreen is lost while enabled', () => {
    setFullscreenElement(document.documentElement)
    const session = new MockLiveSession()
    const spy = vi.spyOn(session, 'sendProctorEvent')
    const onViolation = vi.fn()

    renderProctor(session, true, onViolation)

    act(() => {
      setFullscreenElement(null)
      document.dispatchEvent(new Event('fullscreenchange'))
    })

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'fullscreen_exit' }))
    expect(onViolation).toHaveBeenCalledWith(expect.objectContaining({ type: 'fullscreen_exit' }))
  })

  it('emits fullscreen_restored when fullscreen is regained while enabled', () => {
    const session = new MockLiveSession()
    const spy = vi.spyOn(session, 'sendProctorEvent')
    const onViolation = vi.fn()

    renderProctor(session, true, onViolation)

    act(() => {
      setFullscreenElement(document.documentElement)
      document.dispatchEvent(new Event('fullscreenchange'))
    })

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'fullscreen_restored' }))
    expect(onViolation).toHaveBeenCalledWith(expect.objectContaining({ type: 'fullscreen_restored' }))
  })

  it('emits tab_hidden when the tab becomes hidden while enabled', () => {
    const session = new MockLiveSession()
    const spy = vi.spyOn(session, 'sendProctorEvent')
    const onViolation = vi.fn()

    renderProctor(session, true, onViolation)

    act(() => {
      setDocumentHidden(true)
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'tab_hidden' }))
    expect(onViolation).toHaveBeenCalledWith(expect.objectContaining({ type: 'tab_hidden' }))
  })

  it('emits tab_visible when the tab becomes visible again while enabled', () => {
    setDocumentHidden(true)
    const session = new MockLiveSession()
    const spy = vi.spyOn(session, 'sendProctorEvent')
    const onViolation = vi.fn()

    renderProctor(session, true, onViolation)

    act(() => {
      setDocumentHidden(false)
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'tab_visible' }))
    expect(onViolation).toHaveBeenCalledWith(expect.objectContaining({ type: 'tab_visible' }))
  })

  it('does not emit when disabled, even on a real transition', () => {
    const session = new MockLiveSession()
    const spy = vi.spyOn(session, 'sendProctorEvent')
    const onViolation = vi.fn()

    renderProctor(session, false, onViolation)

    act(() => {
      setDocumentHidden(true)
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(spy).not.toHaveBeenCalled()
    expect(onViolation).not.toHaveBeenCalled()
  })

  it('derives active from fullscreen/hidden state and violations from the session machine', () => {
    // Start fullscreen and visible: neither half of `!isFullscreen || hidden` is true, so active=false.
    setFullscreenElement(document.documentElement)
    const session = new MockLiveSession()
    const onViolation = vi.fn()

    const { result } = renderProctor(session, true, onViolation)

    expect(result.current.active).toBe(false)
    expect(result.current.violations).toBe(0)

    act(() => {
      setDocumentHidden(true)
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(result.current.active).toBe(true)
  })
})
