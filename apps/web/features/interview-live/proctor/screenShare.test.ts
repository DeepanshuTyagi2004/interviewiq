import { afterEach, describe, expect, it, vi } from 'vitest'
import { isPrompting, isScreenShared, requestEntireScreen, stopScreenShare } from './screenShare'

function fakeShare(surface: string | undefined) {
  let ended: (() => void) | undefined
  const track = {
    kind: 'video',
    stop: vi.fn(),
    getSettings: () => (surface ? { displaySurface: surface } : {}),
    addEventListener: (type: string, cb: () => void) => { if (type === 'ended') ended = cb },
  }
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] }
  return { stream, track, end: () => ended?.() }
}

function mockDisplayMedia(impl: () => Promise<unknown>) {
  Object.assign(navigator.mediaDevices, { getDisplayMedia: vi.fn(impl) })
}

afterEach(() => {
  stopScreenShare()
  Reflect.deleteProperty(navigator.mediaDevices, 'getDisplayMedia')
})

describe('requestEntireScreen', () => {
  it('accepts an entire-screen share and tracks it until it ends', async () => {
    const share = fakeShare('monitor')
    mockDisplayMedia(async () => share.stream)
    expect(await requestEntireScreen()).toEqual({ ok: true })
    expect(isScreenShared()).toBe(true)
    share.end()
    expect(isScreenShared()).toBe(false)
  })

  it('refuses a window or tab share and stops it', async () => {
    const share = fakeShare('window')
    mockDisplayMedia(async () => share.stream)
    expect(await requestEntireScreen()).toEqual({ ok: false, reason: 'not_entire_screen' })
    expect(share.track.stop).toHaveBeenCalled()
    expect(isScreenShared()).toBe(false)
  })

  it('reports a denied prompt and a browser without screen sharing', async () => {
    mockDisplayMedia(async () => { throw new Error('NotAllowedError') })
    expect(await requestEntireScreen()).toEqual({ ok: false, reason: 'denied' })
    Reflect.deleteProperty(navigator.mediaDevices, 'getDisplayMedia')
    expect(await requestEntireScreen()).toEqual({ ok: false, reason: 'unsupported' })
  })

  it('is prompting only while the picker is open', async () => {
    let resolve: (s: unknown) => void = () => {}
    mockDisplayMedia(() => new Promise((r) => { resolve = r }))
    const pending = requestEntireScreen()
    expect(isPrompting()).toBe(true)
    resolve(fakeShare('monitor').stream)
    await pending
    expect(isPrompting()).toBe(false)
  })
})
