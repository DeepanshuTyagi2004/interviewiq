import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { MockLiveSession } from '../session/MockLiveSession'
import { MERGE_WINDOW_MS } from './ledger'
import { requestEntireScreen, stopScreenShare } from './screenShare'
import { WARNING_TEXT, useProctor } from './useProctor'
import type { ExtendedScreen } from './useExternalDisplay'

let hidden = false
function setFullscreen(on: boolean) {
  ;(document as unknown as { fullscreenElement: Element | null }).fullscreenElement = on ? document.documentElement : null
  document.dispatchEvent(new Event('fullscreenchange'))
}

beforeEach(() => {
  hidden = false
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  ;(document as unknown as { fullscreenElement: Element | null }).fullscreenElement = document.documentElement
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  stopScreenShare()
  Reflect.deleteProperty(navigator.mediaDevices, 'getDisplayMedia')
})

describe('useProctor', () => {
  it('counts a tab switch once and reports one merged event', () => {
    const session = new MockLiveSession()
    const { result } = renderHook(() => useProctor({ session, enabled: true }))
    act(() => {
      window.dispatchEvent(new Event('blur'))
      hidden = true
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current.ledger).toMatchObject({ tabChanges: 1, screenChanges: 0, fullViolations: 1 })
    expect(result.current.toast).toBe(WARNING_TEXT)
    expect(session.sentOf('proctor.event')).toHaveLength(0)
    act(() => { vi.advanceTimersByTime(MERGE_WINDOW_MS) })
    expect(session.sentOf('proctor.event')).toEqual([
      expect.objectContaining({ kind: 'tab_hidden', weight: 1, counts: { tab_changes: 1, screen_changes: 0, full_violations: 1 } }),
    ])
  })

  it('weights leaving full screen at one half and shows the return bar', () => {
    const session = new MockLiveSession()
    const { result } = renderHook(() => useProctor({ session, enabled: true }))
    act(() => setFullscreen(false))
    expect(result.current.ledger.screenChanges).toBe(0.5)
    expect(result.current.outOfFullscreen).toBe(true)
    act(() => { vi.advanceTimersByTime(MERGE_WINDOW_MS) })
    expect(session.sentOf('proctor.event')[0]).toMatchObject({ kind: 'fullscreen_exit', weight: 0.5 })
  })

  it('counts a round that starts out of full screen', () => {
    ;(document as unknown as { fullscreenElement: Element | null }).fullscreenElement = null
    const { result } = renderHook(() => useProctor({ session: new MockLiveSession(), enabled: true }))
    expect(result.current.ledger.entries[0]?.kind).toBe('fullscreen_exit')
  })

  it('counts a stopped share at one half', async () => {
    let end = () => {}
    const track = { kind: 'video', stop: vi.fn(), getSettings: () => ({ displaySurface: 'monitor' }), addEventListener: (_t: string, cb: () => void) => { end = cb } }
    Object.assign(navigator.mediaDevices, { getDisplayMedia: vi.fn(async () => ({ getTracks: () => [track], getVideoTracks: () => [track] })) })
    await requestEntireScreen()
    const { result } = renderHook(() => useProctor({ session: new MockLiveSession(), enabled: true }))
    act(() => end())
    expect(result.current.shareStopped).toBe(true)
    expect(result.current.ledger.entries[0]).toMatchObject({ kind: 'share_stopped', weight: 0.5 })
  })

  it('ignores the window blur caused by the share picker', async () => {
    Object.assign(navigator.mediaDevices, { getDisplayMedia: vi.fn(() => new Promise(() => {})) })
    const { result } = renderHook(() => useProctor({ session: new MockLiveSession(), enabled: true }))
    void requestEntireScreen()
    act(() => { window.dispatchEvent(new Event('blur')) })
    expect(result.current.ledger.entries).toEqual([])
  })
})

describe('useProctor second display', () => {
  const scr = window.screen as ExtendedScreen
  afterEach(() => { Reflect.deleteProperty(scr, 'isExtended') })

  it('does not count a second display that was already connected when the round began', () => {
    Object.defineProperty(scr, 'isExtended', { configurable: true, writable: true, value: true })
    const { result } = renderHook(() => useProctor({ session: new MockLiveSession(), enabled: true }))
    expect(result.current.ledger.entries).toEqual([])   // the checks warned about it; it is not a violation mid-round
  })

  it('counts a display that is connected after the round began', () => {
    let onChange: () => void = () => {}
    Object.defineProperty(scr, 'isExtended', { configurable: true, writable: true, value: false })
    const add = scr.addEventListener
    scr.addEventListener = ((type: string, cb: () => void) => { if (type === 'change') onChange = cb }) as typeof scr.addEventListener
    try {
      const { result } = renderHook(() => useProctor({ session: new MockLiveSession(), enabled: true }))
      expect(result.current.ledger.entries).toEqual([])
      act(() => { scr.isExtended = true; onChange() })
      expect(result.current.ledger.entries[0]).toMatchObject({ kind: 'external_display', weight: 1 })
    } finally {
      scr.addEventListener = add
    }
  })
})
