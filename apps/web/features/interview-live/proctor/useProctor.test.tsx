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

function setScreenIsExtended(value: boolean | undefined) {
  const scr = window.screen as Screen & { isExtended?: boolean }
  if (value === undefined) {
    delete scr.isExtended
  } else {
    Object.defineProperty(window.screen, 'isExtended', { configurable: true, value })
  }
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
    setScreenIsExtended(undefined)
  })

  it('does not emit any ProctorEvent on initial mount when already fullscreen and visible', () => {
    // A genuinely clean baseline (unlike the default fixture, which is NOT fullscreen — see the
    // Q2 "already-out-of-fullscreen-on-enable" test below for that case).
    setFullscreenElement(document.documentElement)
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

  // --- Batch 2 ---

  it('Q1: emits exactly ONE tab_hidden violation for window blur, deduped against visibilitychange', () => {
    setFullscreenElement(document.documentElement) // clean baseline: fullscreen + visible
    const session = new MockLiveSession()
    const spy = vi.spyOn(session, 'sendProctorEvent')
    const onViolation = vi.fn()

    renderProctor(session, true, onViolation)

    // A real tab-switch/alt-tab fires BOTH window.blur AND document.visibilitychange (hidden=true).
    act(() => {
      setDocumentHidden(true)
      window.dispatchEvent(new Event('blur'))
      document.dispatchEvent(new Event('visibilitychange'))
    })

    const tabHiddenCalls = spy.mock.calls.filter(([e]) => e.type === 'tab_hidden')
    expect(tabHiddenCalls).toHaveLength(1)
    const tabHiddenViolations = onViolation.mock.calls.filter(([e]) => e.type === 'tab_hidden')
    expect(tabHiddenViolations).toHaveLength(1)
  })

  it('Q1: window.blur alone (no visibilitychange) emits tab_hidden, and focus emits tab_visible', () => {
    setFullscreenElement(document.documentElement)
    const session = new MockLiveSession()
    const spy = vi.spyOn(session, 'sendProctorEvent')
    const onViolation = vi.fn()

    renderProctor(session, true, onViolation)

    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'tab_hidden' }))
    expect(onViolation).toHaveBeenCalledWith(expect.objectContaining({ type: 'tab_hidden' }))

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'tab_visible' }))
    expect(onViolation).toHaveBeenCalledWith(expect.objectContaining({ type: 'tab_visible' }))
  })

  it('Q2: fires fullscreen_exit immediately when enabling while already out of fullscreen', () => {
    // Default fixture (beforeEach): fullscreenElement=null — i.e. already NOT fullscreen when
    // proctoring turns on, simulating entering `live` already out of fullscreen.
    const session = new MockLiveSession()
    const spy = vi.spyOn(session, 'sendProctorEvent')
    const onViolation = vi.fn()

    renderProctor(session, true, onViolation)

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'fullscreen_exit' }))
    expect(onViolation).toHaveBeenCalledWith(expect.objectContaining({ type: 'fullscreen_exit' }))
  })

  it('Q2: fires tab_hidden immediately when enabling while already hidden', () => {
    setFullscreenElement(document.documentElement) // isolate from the fullscreen half of Q2
    setDocumentHidden(true)
    const session = new MockLiveSession()
    const spy = vi.spyOn(session, 'sendProctorEvent')
    const onViolation = vi.fn()

    renderProctor(session, true, onViolation)

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'tab_hidden' }))
    expect(onViolation).toHaveBeenCalledWith(expect.objectContaining({ type: 'tab_hidden' }))
  })

  it('Q2: does not fire immediately on mount when disabled, even if already out of fullscreen', () => {
    // fullscreenElement=null (default) — already a violation — but proctoring is disabled.
    const session = new MockLiveSession()
    const spy = vi.spyOn(session, 'sendProctorEvent')
    const onViolation = vi.fn()

    renderProctor(session, false, onViolation)

    expect(spy).not.toHaveBeenCalled()
    expect(onViolation).not.toHaveBeenCalled()
  })

  it('Q3: emits external_display_detected once the Window Management API reports an extended display', async () => {
    setFullscreenElement(document.documentElement)
    setScreenIsExtended(true)
    const session = new MockLiveSession()
    const spy = vi.spyOn(session, 'sendProctorEvent')
    const onViolation = vi.fn()

    await act(async () => {
      renderProctor(session, true, onViolation)
    })

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'external_display_detected' }))
    expect(onViolation).toHaveBeenCalledWith(expect.objectContaining({ type: 'external_display_detected' }))
  })

  it('Q3: does not emit external_display_detected when no extended display is reported', async () => {
    setFullscreenElement(document.documentElement)
    setScreenIsExtended(false)
    const session = new MockLiveSession()
    const spy = vi.spyOn(session, 'sendProctorEvent')
    const onViolation = vi.fn()

    await act(async () => {
      renderProctor(session, true, onViolation)
    })

    expect(spy).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'external_display_detected' }))
  })
})
