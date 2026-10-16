import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

const BYTES = new Uint8Array([1, 2, 3, 4, 5])
const SHA = createHash('sha256').update(BYTES).digest('hex')
const URL_ = 'https://cdn.example/model.bin'

/** A Cache Storage stand-in: named caches of url → body bytes. */
function fakeCaches() {
  const stores = new Map<string, Map<string, Uint8Array>>()
  const open = async (name: string) => {
    const store = stores.get(name) ?? new Map<string, Uint8Array>()
    stores.set(name, store)
    return {
      match: async (url: string) => (store.has(url) ? new Response(store.get(url) as BodyInit) : undefined),
      put: async (url: string, res: Response) => { store.set(url, new Uint8Array(await res.arrayBuffer())) },
      delete: async (url: string) => store.delete(url),
    }
  }
  return {
    stores,
    api: { open, keys: async () => [...stores.keys()], delete: async (name: string) => stores.delete(name) },
  }
}

let cs: ReturnType<typeof fakeCaches>
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetModules()
  cs = fakeCaches()
  vi.stubGlobal('caches', cs.api)
  fetchMock = vi.fn(async () => new Response(BYTES as BodyInit))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('loadModelFile', () => {
  it('downloads once, then serves later interviews from the device', async () => {
    const { loadModelFile } = await import('./modelCache')
    expect(Array.from(await loadModelFile(URL_, SHA))).toEqual([1, 2, 3, 4, 5])
    expect(Array.from(await loadModelFile(URL_, SHA))).toEqual([1, 2, 3, 4, 5])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shares one download between concurrent callers', async () => {
    const { loadModelFile } = await import('./modelCache')
    await Promise.all([loadModelFile(URL_, SHA), loadModelFile(URL_, SHA)])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refuses and never caches a file that fails its checksum', async () => {
    const { loadModelFile, CACHE_NAME } = await import('./modelCache')
    await expect(loadModelFile(URL_, 'f'.repeat(64))).rejects.toThrow(/checksum/)
    expect(cs.stores.get(CACHE_NAME)?.size ?? 0).toBe(0)
  })

  it('replaces a corrupted cached copy with a fresh download', async () => {
    const { loadModelFile, CACHE_NAME } = await import('./modelCache')
    const store = await cs.api.open(CACHE_NAME)
    await store.put(URL_, new Response(new Uint8Array([9, 9]) as BodyInit))
    expect(Array.from(await loadModelFile(URL_, SHA))).toEqual([1, 2, 3, 4, 5])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('deletes caches left by older model versions', async () => {
    await cs.api.open('iq-vision-v0')
    await cs.api.open('someone-elses-cache')
    const { loadModelFile, CACHE_NAME } = await import('./modelCache')
    await loadModelFile(URL_, SHA)
    expect([...cs.stores.keys()].sort()).toEqual([CACHE_NAME, 'someone-elses-cache'].sort())
  })

  it('still works, downloading each time, where Cache Storage is missing', async () => {
    vi.stubGlobal('caches', undefined)
    const { loadModelFile } = await import('./modelCache')
    await loadModelFile(URL_, SHA)
    await loadModelFile(URL_, SHA)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
