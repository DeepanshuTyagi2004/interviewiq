import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Recharts ResponsiveContainer needs ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;

// shadcn sidebar / useMediaQuery read matchMedia.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

// --- live-interview media/fullscreen stubs (jsdom has none) ---
class FakeMediaStreamTrack { kind = 'audio'; enabled = true; stop() {} }
class FakeMediaStream {
  private tracks: FakeMediaStreamTrack[]
  constructor(kinds: string[] = ['audio', 'video']) {
    this.tracks = kinds.map((k) => Object.assign(new FakeMediaStreamTrack(), { kind: k }))
  }
  getTracks() { return this.tracks }
  getAudioTracks() { return this.tracks.filter((t) => t.kind === 'audio') }
  getVideoTracks() { return this.tracks.filter((t) => t.kind === 'video') }
}
type MutableFullscreenDocument = { fullscreenElement: Element | null }

;(globalThis as unknown as { MediaStream: typeof MediaStream }).MediaStream =
  FakeMediaStream as unknown as typeof MediaStream
Object.defineProperty(globalThis.navigator, 'mediaDevices', {
  configurable: true,
  value: { getUserMedia: vi.fn(async () => new FakeMediaStream()) },
})
Object.defineProperty(document, 'fullscreenElement', { configurable: true, writable: true, value: null })
document.documentElement.requestFullscreen = vi.fn(async function (this: HTMLElement) {
  ;(document as unknown as MutableFullscreenDocument).fullscreenElement = this
})
document.exitFullscreen = vi.fn(async () => {
  ;(document as unknown as MutableFullscreenDocument).fullscreenElement = null
})
class FakeAudioContext {
  createAnalyser() { return { fftSize: 0, frequencyBinCount: 32, getByteTimeDomainData: (a: Uint8Array) => a.fill(128) } }
  createMediaStreamSource() { return { connect() {} } }
  close() {}
}
;(globalThis as unknown as { AudioContext: typeof AudioContext }).AudioContext =
  FakeAudioContext as unknown as typeof AudioContext

// The on-device camera check's models never load in tests (they come from CDNs); tests that need them pass fakes.
vi.mock('@/features/interview-live/proctor/camera/vision', () => ({
  ASSETS: {},
  loadFaceLandmarker: () => Promise.reject(new Error('no vision models in tests')),
  loadFaceEmbedder: () => Promise.reject(new Error('no vision models in tests')),
}))
