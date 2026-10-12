import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { MockLiveSession } from '../session/MockLiveSession'
import { MERGE_WINDOW_MS } from './ledger'
import { requestEntireScreen, stopScreenShare } from './screenShare'
import { WARNING_TEXT, PASTE_TEXT, useProctor } from './useProctor'
import { clearSystemClipboard, resetClipboard } from './localClipboard'
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

describe('useProctor return clock', () => {
  it('opens an episode when full screen is left, tells the worker at once, and closes it on return', () => {
    const session = new MockLiveSession()
    const { result } = renderHook(() => useProctor({ session, enabled: true }))
    expect(result.current.away).toBeNull()
    act(() => setFullscreen(false))
    expect(result.current.away).toMatchObject({ kinds: ['fullscreen_exit'], tight: false })
    expect(session.sentOf('proctor.away')).toEqual([expect.objectContaining({ kinds: ['fullscreen_exit'] })])   // before the 1.5 s merge window
    act(() => setFullscreen(true))
    expect(result.current.away).toBeNull()
    expect(session.sentOf('proctor.back')).toHaveLength(1)
  })

  it('sends the new set when another signal joins, and keeps the strict limit once the tab is left', () => {
    const session = new MockLiveSession()
    const { result } = renderHook(() => useProctor({ session, enabled: true }))
    act(() => setFullscreen(false))
    act(() => { hidden = true; document.dispatchEvent(new Event('visibilitychange')) })
    expect(session.sentOf('proctor.away').at(-1)).toMatchObject({ kinds: ['tab_hidden', 'fullscreen_exit'] })
    expect(result.current.away?.tight).toBe(true)
    act(() => { hidden = false; document.dispatchEvent(new Event('visibilitychange')) })
    expect(result.current.away).toMatchObject({ kinds: ['fullscreen_exit'], tight: true })
  })

  it('tells the candidate they stayed past the limit, and says nothing about a quick return', () => {
    const slow = renderHook(() => useProctor({ session: new MockLiveSession(), enabled: true }))
    act(() => setFullscreen(false))
    act(() => { vi.advanceTimersByTime(31_000) })
    act(() => setFullscreen(true))
    expect(slow.result.current.toast).toMatch(/away 31 s, past the 30 s limit.*extra violation/)
    slow.unmount()

    const quick = renderHook(() => useProctor({ session: new MockLiveSession(), enabled: true }))
    act(() => setFullscreen(false))
    act(() => { vi.advanceTimersByTime(5000) })
    act(() => setFullscreen(true))
    expect(quick.result.current.toast).toBeNull()
  })

  it('does not treat a room that never had a screen share as having lost it', () => {
    const session = new MockLiveSession()
    const { result } = renderHook(() => useProctor({ session, enabled: true }))
    expect(result.current.shareStopped).toBe(true)
    expect(result.current.away).toBeNull()
    expect(session.sentOf('proctor.away')).toHaveLength(0)
  })

  it('opens an episode when a share that was running stops', async () => {
    let end = () => {}
    const track = { kind: 'video', stop: vi.fn(), getSettings: () => ({ displaySurface: 'monitor' }), addEventListener: (_t: string, cb: () => void) => { end = cb } }
    Object.assign(navigator.mediaDevices, { getDisplayMedia: vi.fn(async () => ({ getTracks: () => [track], getVideoTracks: () => [track] })) })
    await requestEntireScreen()
    const session = new MockLiveSession()
    const { result } = renderHook(() => useProctor({ session, enabled: true }))
    expect(result.current.away).toBeNull()
    act(() => end())
    expect(result.current.away).toMatchObject({ kinds: ['share_stopped'], tight: false })
    expect(session.sentOf('proctor.away')).toEqual([expect.objectContaining({ kinds: ['share_stopped'] })])
  })

  it('does not open an episode for a second display, which cannot be undone', () => {
    const scr = window.screen as ExtendedScreen
    let onChange: () => void = () => {}
    Object.defineProperty(scr, 'isExtended', { configurable: true, writable: true, value: false })
    const add = scr.addEventListener
    scr.addEventListener = ((type: string, cb: () => void) => { if (type === 'change') onChange = cb }) as typeof scr.addEventListener
    try {
      const session = new MockLiveSession()
      const { result } = renderHook(() => useProctor({ session, enabled: true }))
      act(() => { scr.isExtended = true; onChange() })
      expect(result.current.ledger.entries[0]).toMatchObject({ kind: 'external_display' })
      expect(result.current.away).toBeNull()
      expect(session.sentOf('proctor.away')).toHaveLength(0)
    } finally {
      scr.addEventListener = add
      Reflect.deleteProperty(scr, 'isExtended')
    }
  })

  it('survives a session that throws while reconnecting', () => {
    const session = new MockLiveSession()
    vi.spyOn(session, 'send').mockImplementation(() => { throw new Error('reconnecting') })
    const { result } = renderHook(() => useProctor({ session, enabled: true }))
    expect(() => act(() => setFullscreen(false))).not.toThrow()
    expect(result.current.away).not.toBeNull()
  })

  it('forgets an open episode when proctoring is switched off', () => {
    const session = new MockLiveSession()
    const { result, rerender } = renderHook(({ enabled }: { enabled: boolean }) => useProctor({ session, enabled }), { initialProps: { enabled: true } })
    act(() => setFullscreen(false))
    expect(result.current.away).not.toBeNull()
    rerender({ enabled: false })
    expect(result.current.away).toBeNull()
  })
})

describe('useProctor foreign paste', () => {
  afterEach(() => {
    resetClipboard()
    vi.unstubAllEnvs()
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  it('shows the warning and tells the worker the size, never the text', () => {
    const session = new MockLiveSession()
    const { result } = renderHook(() => useProctor({ session, enabled: true }))
    act(() => result.current.foreignPaste({ source: 'paste', chars: 120, lines: 6 }))
    expect(result.current.toast).toBe(PASTE_TEXT)
    expect(session.sentOf('proctor.event')).toEqual([
      expect.objectContaining({ kind: 'foreign_paste', weight: 1, source: 'paste', chars: 120, lines: 6, clipboard_cleared: false }),
    ])
  })

  it('says the clipboard was cleared at Join when it was', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } })
    await clearSystemClipboard()
    const session = new MockLiveSession()
    const { result } = renderHook(() => useProctor({ session, enabled: true }))
    act(() => result.current.foreignPaste({ source: 'drop', chars: 9, lines: 1 }))
    expect(session.sentOf('proctor.event')[0]).toMatchObject({ source: 'drop', clipboard_cleared: true })
  })
})
