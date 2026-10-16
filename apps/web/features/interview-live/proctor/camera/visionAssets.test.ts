import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Mod = typeof import('./visionAssets')

/** Small stand-in files: same five slots, bytes we can hash. */
function fakeFile(id: string, size: number) {
  const bytes = new Uint8Array(size).map((_, i) => (i + id.length) % 251)
  return { bytes, spec: { name: id, url: `https://cdn.test/${id}`, sha256: createHash('sha256').update(bytes).digest('hex'), size } }
}
const FILES = { mpLoader: fakeFile('mpLoader', 10), landmarker: fakeFile('landmarker', 20), mpWasm: fakeFile('mpWasm', 30), sface: fakeFile('sface', 40), ortWasm: fakeFile('ortWasm', 50) }
const TOTAL = 150

function fakeCaches() {
  const stores = new Map<string, Map<string, { body: Uint8Array; headers: Record<string, string> }>>()
  const open = async (name: string) => {
    const store = stores.get(name) ?? new Map()
    stores.set(name, store)
    return {
      match: async (url: string) => {
        const e = store.get(url)
        return e ? new Response(e.body as BodyInit, { headers: e.headers }) : undefined
      },
      put: async (url: string, res: Response) => {
        store.set(url, { body: new Uint8Array(await res.arrayBuffer()), headers: Object.fromEntries(res.headers) })
      },
      delete: async (url: string) => store.delete(url),
    }
  }
  return { stores, api: { open, keys: async () => [...stores.keys()], delete: async (n: string) => stores.delete(n) } }
}

/** Serves FILES by URL; `gate` lets a test hold a response open until it says so. */
function fakeFetch(opts: { corrupt?: string; gate?: Promise<void> } = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const f = Object.values(FILES).find((x) => x.spec.url === url)!
    if (opts.gate) {
      await new Promise<void>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        void opts.gate!.then(resolve)
      })
    }
    const body = opts.corrupt === f.spec.name ? f.bytes.map((b) => b ^ 1) : f.bytes
    return new Response(body as BodyInit)
  })
}

let cs: ReturnType<typeof fakeCaches>

async function load(fetchImpl: ReturnType<typeof fakeFetch>): Promise<Mod> {
  vi.resetModules()
  vi.stubGlobal('fetch', fetchImpl)
  const mod = await import('./visionAssets')
  for (const [id, f] of Object.entries(FILES)) (mod.VISION_FILES as Record<string, unknown>)[id] = f.spec
  return mod
}

async function settle(m: Mod, phase: string) {
  await vi.waitFor(() => expect(m.getVisionState().phase).toBe(phase))
}

beforeEach(() => {
  cs = fakeCaches()
  vi.stubGlobal('caches', cs.api)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('visionAssets', () => {
  it('says unsupported, and fetches nothing, without Cache Storage', async () => {
    vi.stubGlobal('caches', undefined)
    const f = fakeFetch()
    const m = await load(f)
    m.startVisionDownload()
    await settle(m, 'unsupported')
    expect(f).not.toHaveBeenCalled()
  })

  it('reports missing files without downloading until started', async () => {
    const f = fakeFetch()
    const m = await load(f)
    m.checkVisionAssets()
    await settle(m, 'missing')
    expect(f).not.toHaveBeenCalled()
  })

  it('downloads every file once, and a later visit finds them all on the device', async () => {
    const f = fakeFetch()
    const m = await load(f)
    m.startVisionDownload()
    await settle(m, 'ready')
    expect(m.getVisionState()).toMatchObject({ received: TOTAL, total: TOTAL })
    expect(f).toHaveBeenCalledTimes(5)
    expect(Array.from(await m.readVisionFile('sface'))).toEqual(Array.from(FILES.sface.bytes))

    const again = fakeFetch()
    const m2 = await load(again)
    m2.startVisionDownload()
    await settle(m2, 'ready')
    expect(again).not.toHaveBeenCalled()
  })

  it('pauses while an interview holds it and carries on after', async () => {
    let open!: () => void
    const f = fakeFetch({ gate: new Promise<void>((r) => { open = r }) })
    const m = await load(f)
    m.startVisionDownload()
    await settle(m, 'downloading')
    const release = m.holdVisionDownload()
    await settle(m, 'paused')
    open()
    release()
    await settle(m, 'ready')
  })

  it('never stores a file that fails its checksum, and ends in error after its retries', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const m = await load(fakeFetch({ corrupt: 'mpWasm' }))
    m.startVisionDownload()
    // Hashing and Cache Storage are real async work, so keep advancing the faked retry waits until it gives up.
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
      expect(m.getVisionState().phase).toBe('error')
    }, { timeout: 10_000, interval: 10 })
    await expect(m.readVisionFile('mpWasm')).rejects.toThrow(/not on this device/)
    // The files before it were kept.
    expect(Array.from(await m.readVisionFile('landmarker'))).toEqual(Array.from(FILES.landmarker.bytes))
  })

  it('reads only from the device: a missing file throws instead of downloading', async () => {
    const f = fakeFetch()
    const m = await load(f)
    await expect(m.readVisionFile('landmarker')).rejects.toThrow(/not on this device/)
    expect(f).not.toHaveBeenCalled()
  })
})
