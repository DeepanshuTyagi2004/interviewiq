import { describe, expect, it, vi } from 'vitest'

const create = vi.fn(async () => ({ inputNames: ['input'], outputNames: ['output'], release: vi.fn() }))
const env = { wasm: {} as Record<string, unknown>, logLevel: 'warning' }
vi.mock('onnxruntime-web/wasm', () => ({ env, InferenceSession: { create } }))
vi.mock('./visionAssets', () => ({ readVisionFile: vi.fn(async () => new Uint8Array([1])) }))

describe('loadFaceEmbedder', () => {
  it('creates the face model session with only errors logged', async () => {
    // The face model loads with ~150 graph warnings ("Initializer ... appears in graph inputs"); at the session's default
    // level each one became a console error in the live room. env.logLevel alone does not reach the session's logger.
    // The test setup mocks this module for every other test; this one needs the real loader (its runtime and files mocked above).
    const { loadFaceEmbedder } = await vi.importActual<typeof import('./vision')>('./vision')
    await loadFaceEmbedder().catch(() => undefined)            // jsdom has no 2d canvas; the session is created first
    expect(create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ logSeverityLevel: 3 }))
    expect(env.logLevel).toBe('error')
  })
})
