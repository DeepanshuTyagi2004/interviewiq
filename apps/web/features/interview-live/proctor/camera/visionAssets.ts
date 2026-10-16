'use client'
/**
 * The camera check's files (two WebAssembly runtimes, two models), downloaded once per device in the background
 * and kept in Cache Storage. The live room only ever reads them from there, so an interview never downloads them:
 * if they aren't on the device yet, the round runs without the camera check.
 *
 * - `startVisionDownload()`: called a few seconds after a signed-in page loads; downloads whatever is missing.
 * - `holdVisionDownload()`: the live room holds the download for its whole length (bandwidth goes to the
 *   interview); a file cut off half way starts again when the hold is released.
 * - `readVisionFile()`: the room's loaders; the device copy only, checked against its SHA-256.
 *
 * Every file is checked against its SHA-256 before it is stored, so a broken or tampered download is never kept.
 */
import { useSyncExternalStore } from 'react'

export type VisionFile = 'mpLoader' | 'mpWasm' | 'landmarker' | 'sface' | 'ortWasm'

interface FileSpec {
  /** File name on the CDN and in a self-hosted folder. */
  name: string
  url: string
  sha256: string
  /** Uncompressed bytes; the progress is counted in these (CDNs send some files compressed). */
  size: number
}

// Keep these in step with package.json. Changing any file means bumping CACHE_NAME.
const MEDIAPIPE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'
const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist'
const SFACE_REVISION = '3d7082438a6e4551e840c9b2bb60b71e8da4b524'
export const CACHE_NAME = 'iq-vision-v2'
const CACHE_PREFIX = 'iq-vision-'

/** Set NEXT_PUBLIC_VISION_ASSETS_URL to serve the five files from one folder of your own (same names, same bytes). */
const SELF_HOSTED = process.env.NEXT_PUBLIC_VISION_ASSETS_URL?.replace(/\/$/, '')

function spec(name: string, cdnUrl: string, sha256: string, size: number): FileSpec {
  return { name, url: SELF_HOSTED ? `${SELF_HOSTED}/${name}` : cdnUrl, sha256, size }
}

/** In download order: the face landmarker's three files first, so a cut-short download still has its pieces together. */
export const VISION_FILES: Record<VisionFile, FileSpec> = {
  mpLoader: spec('vision_wasm_internal.js', `${MEDIAPIPE}/vision_wasm_internal.js`,
    'e170ee67dd4e16c1a6fcd8840a206687e5a59b22c20e4a902bc445b095454d73', 323_377),
  landmarker: spec('face_landmarker.task',
    'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff', 3_758_596),
  mpWasm: spec('vision_wasm_internal.wasm', `${MEDIAPIPE}/vision_wasm_internal.wasm`,
    '8da277a733926eacd0474b8704b36742d6ec3231c57a860c5b889dff8f1df886', 11_756_954),
  sface: spec('face_recognition_sface_2021dec_int8.onnx',
    `https://huggingface.co/opencv/face_recognition_sface/resolve/${SFACE_REVISION}/face_recognition_sface_2021dec_int8.onnx`,
    '2b0e941e6f16cc048c20aee0c8e31f569118f65d702914540f7bfdc14048d78a', 9_896_933),
  ortWasm: spec('ort-wasm-simd-threaded.wasm', `${ORT}/ort-wasm-simd-threaded.wasm`,
    '3398c10d07d229bd91b364548e130e0e51a8e5704b88c7c083ebbeb78842dee2', 14_239_897),
}
const ORDER = Object.keys(VISION_FILES) as VisionFile[]
const totalSize = () => ORDER.reduce((s, id) => s + VISION_FILES[id].size, 0)

/**
 * `checking`: looking at what is on the device. `missing`: not all there and not downloading (not started).
 * `downloading` / `paused` (held by an interview) / `ready`. `error`: downloads kept failing; the next start retries.
 * `unsupported`: this browser has no Cache Storage (or it is blocked), so nothing can be kept.
 */
export type VisionPhase = 'checking' | 'missing' | 'downloading' | 'paused' | 'ready' | 'error' | 'unsupported'

export interface VisionState {
  phase: VisionPhase
  /** Bytes on the device or downloaded so far, out of `total`. */
  received: number
  total: number
}

/** Waits between attempts at one file; after the last, the phase is `error` until the next start. */
export const RETRY_MS = [5_000, 20_000]
const EMIT_MS = 250

let state: VisionState = { phase: 'checking', received: 0, total: totalSize() }
const listeners = new Set<() => void>()
let lastEmit = 0

function set(next: Partial<VisionState>, throttle = false) {
  state = { ...state, ...next }
  const now = Date.now()
  if (throttle && now - lastEmit < EMIT_MS) return
  lastEmit = now
  listeners.forEach((l) => l())
}

export function getVisionState(): VisionState {
  return state
}

export function subscribeVision(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const SERVER_STATE: VisionState = { phase: 'checking', received: 0, total: totalSize() }

export function useVisionAssets(): VisionState {
  return useSyncExternalStore(subscribeVision, getVisionState, () => SERVER_STATE)
}

async function openCache(): Promise<Cache | null> {
  try {
    if (typeof caches === 'undefined') return null
    return await caches.open(CACHE_NAME)
  } catch {
    return null
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Stored with its length, so "is it there" never reads the bytes. */
async function isStored(cache: Cache, id: VisionFile): Promise<boolean> {
  const hit = await cache.match(VISION_FILES[id].url).catch(() => undefined)
  return Number(hit?.headers.get('x-iq-size')) === VISION_FILES[id].size
}

let started = false
let holds = 0
let controller: AbortController | null = null
let running: Promise<void> | null = null
let wake: (() => void) | null = null

class Held extends Error {}

const sleep = (ms: number) => new Promise<void>((resolve) => {
  const t = setTimeout(() => { wake = null; resolve() }, ms)
  wake = () => { clearTimeout(t); wake = null; resolve() }
})

async function download(cache: Cache, id: VisionFile, before: number): Promise<void> {
  const f = VISION_FILES[id]
  controller = new AbortController()
  let res: Response
  try {
    res = await fetch(f.url, { signal: controller.signal })
    if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`)
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let got = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      got += value.length
      set({ received: before + Math.min(got, f.size) }, true)
    }
    const bytes = new Uint8Array(got)
    let at = 0
    for (const c of chunks) { bytes.set(c, at); at += c.length }
    if (got !== f.size || (await sha256(bytes)) !== f.sha256) throw new Error(`${f.name} does not match its checksum`)
    await cache.put(f.url, new Response(bytes, { headers: { 'content-type': 'application/octet-stream', 'x-iq-size': String(f.size) } }))
  } catch (e) {
    if (holds > 0) throw new Held()
    throw e
  } finally {
    controller = null
  }
}

async function run(): Promise<void> {
  const cache = await openCache()
  if (!cache) { set({ phase: 'unsupported', received: 0 }); return }
  void pruneOldCaches()
  const stored = await Promise.all(ORDER.map((id) => isStored(cache, id)))
  const missing = ORDER.filter((_, i) => !stored[i])
  let received = ORDER.reduce((s, id, i) => s + (stored[i] ? VISION_FILES[id].size : 0), 0)
  const total = totalSize()
  if (!missing.length) { set({ phase: 'ready', received: total, total }); return }
  if (!started) { set({ phase: 'missing', received, total }); return }

  for (const id of missing) {
    for (let attempt = 0; ; attempt++) {
      if (holds > 0) { set({ phase: 'paused', received }); return }
      set({ phase: 'downloading', received, total })
      try {
        await download(cache, id, received)
        received += VISION_FILES[id].size
        break
      } catch (e) {
        if (e instanceof Held) { set({ phase: 'paused', received }); return }
        if (attempt >= RETRY_MS.length) { set({ phase: 'error', received }); return }
        set({ received })
        await sleep(RETRY_MS[attempt])
      }
    }
  }
  set({ phase: 'ready', received: total })
}

/** Runs (or re-checks) the download; one run at a time, and another pass after it if something changed meanwhile. */
let again = false
function pump(): void {
  if (running) { again = true; return }
  running = run()
    .catch(() => set({ phase: 'error' }))
    .finally(() => {
      running = null
      if (again) { again = false; pump() }
    })
}

/** Starts downloading what is missing, in the background. Safe to call again (e.g. to retry after an error). */
export function startVisionDownload(): void {
  started = true
  wake?.()
  pump()
}

/** Only looks at what is on the device (e.g. to show it before the background download starts). */
export function checkVisionAssets(): void {
  pump()
}

/** Pauses the download until the returned release is called (the live room holds it for the round). */
export function holdVisionDownload(): () => void {
  holds += 1
  controller?.abort()
  if (state.phase === 'downloading') set({ phase: 'paused' })
  let released = false
  return () => {
    if (released) return
    released = true
    holds -= 1
    if (holds === 0 && started) pump()
  }
}

/** A file from the device only, checked against its SHA-256; never downloads. Throws when it isn't there. */
export async function readVisionFile(id: VisionFile): Promise<Uint8Array> {
  const f = VISION_FILES[id]
  const cache = await openCache()
  const hit = await cache?.match(f.url).catch(() => undefined)
  if (!hit) throw new Error(`${f.name} is not on this device`)
  const bytes = new Uint8Array(await hit.arrayBuffer())
  if ((await sha256(bytes)) !== f.sha256) {
    await cache?.delete(f.url).catch(() => false)
    throw new Error(`${f.name} is damaged`)
  }
  return bytes
}

let pruned = false
async function pruneOldCaches(): Promise<void> {
  if (pruned) return
  pruned = true
  try {
    for (const name of await caches.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) await caches.delete(name)
    }
  } catch {
    // best effort
  }
}

if (typeof window !== 'undefined') {
  // A download that failed while offline tries again when the connection is back.
  window.addEventListener('online', () => { if (started && state.phase === 'error') startVisionDownload() })
}
