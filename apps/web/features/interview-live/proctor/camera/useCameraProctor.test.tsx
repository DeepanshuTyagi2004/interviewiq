import { act, renderHook } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Point } from './face'
import { FRAME_MS, useCameraProctor, type CameraLoaders, type Landmarker } from './useCameraProctor'

/** A frontal face mesh: only the points the geometry reads matter. */
const FACE: Point[] = Array.from({ length: 478 }, (_, i) => (
  ({ 1: { x: 0.5, y: 0.5 }, 234: { x: 0.4, y: 0.5 }, 454: { x: 0.6, y: 0.5 }, 10: { x: 0.5, y: 0.3 }, 152: { x: 0.5, y: 0.7 } } as Record<number, Point>)[i]
  ?? { x: 0.5, y: 0.5 }
))

const ME = new Float32Array([1, 0.1, 0])
const SOMEONE_ELSE = new Float32Array([0, 1, 0.2])

let faces = 1
let person = ME

const fakeLoaders = (): CameraLoaders => ({
  landmarker: async (): Promise<Landmarker> => ({
    detectForVideo: () => ({
      faceLandmarks: Array.from({ length: faces }, () => FACE),
      faceBlendshapes: Array.from({ length: faces }, () => ({ categories: [] })),
    }),
    close: () => {},
  }),
  embedder: async () => ({ embed: async () => person, close: () => {} }),
})

// One stream per test: a new one on every render would restart the hook.
const stream = () => new MediaStream() as unknown as MediaStream

async function frames(n: number) {
  for (let i = 0; i < n; i++) await act(async () => { await vi.advanceTimersByTimeAsync(FRAME_MS) })
}

const props = ['readyState', 'videoWidth', 'videoHeight'] as const
beforeAll(() => {
  Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => 4 })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 480 })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})
afterAll(() => {
  for (const p of props) delete (HTMLVideoElement.prototype as unknown as Record<string, unknown>)[p]
  delete (HTMLMediaElement.prototype as unknown as Record<string, unknown>).readyState
  vi.restoreAllMocks()
})
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  faces = 1
  person = ME
})
afterEach(() => vi.useRealTimers())

describe('useCameraProctor', () => {
  it('turns itself off, and flags nothing, when the models cannot load', async () => {
    // vitest.setup.ts makes the real loaders fail.
    const s = stream()
    const { result } = renderHook(() => useCameraProctor({ stream: s, enabled: true }))
    await frames(2)
    expect(result.current).toEqual({ status: 'unavailable', reason: null, flags: [] })
  })

  it('is unavailable without a camera track', () => {
    const audioOnly = new MediaStream(['audio'] as unknown as MediaStreamTrack[]) as unknown as MediaStream
    const loaders = fakeLoaders()
    const { result } = renderHook(() => useCameraProctor({ stream: audioOnly, enabled: true, loaders }))
    expect(result.current.status).toBe('unavailable')
  })

  it('is green for one person and turns red with one flag when a second face stays in view', async () => {
    const loaders = fakeLoaders()
    const s = stream()
    const { result } = renderHook(() => useCameraProctor({ stream: s, enabled: true, loaders }))
    await frames(3)
    expect(result.current.status).toBe('ok')
    faces = 2
    await frames(1)
    expect(result.current).toMatchObject({ status: 'warn', reason: 'multiple_faces' })
    await frames(10)
    expect(result.current).toMatchObject({ status: 'violation', reason: 'multiple_faces' })
    expect(result.current.flags.map((f) => f.kind)).toEqual(['multiple_faces'])
    faces = 1
    await frames(10)
    expect(result.current.status).toBe('ok')
    expect(result.current.flags).toHaveLength(1)
  })

  it('flags a different person after the candidate was enrolled', async () => {
    const loaders = fakeLoaders()
    const s = stream()
    const { result } = renderHook(() => useCameraProctor({ stream: s, enabled: true, loaders }))
    // Gaze baseline (2 s), then three enrolment embeddings.
    await frames(30)
    expect(result.current.status).toBe('ok')
    person = SOMEONE_ELSE
    await frames(40)
    expect(result.current).toMatchObject({ status: 'violation', reason: 'face_changed' })
    expect(result.current.flags.map((f) => f.kind)).toEqual(['face_changed'])
  })
})
