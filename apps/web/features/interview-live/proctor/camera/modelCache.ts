/**
 * Keeps the camera check's model files on the candidate's device between interviews (Cache Storage),
 * so a second interview the same day, or any later one, downloads nothing. Each file is checked against
 * its SHA-256 before it is used or stored, so a truncated or tampered download is never cached.
 *
 * The WebAssembly runtimes don't need this: jsDelivr serves versioned files as immutable for a year, so
 * the browser's own HTTP cache keeps them.
 */

/** Bump when a model file changes; older caches are deleted on the next load. */
export const CACHE_NAME = 'iq-vision-v1'
const CACHE_PREFIX = 'iq-vision-'

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('')
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>))
}

/** Cache Storage only exists in secure contexts (https, localhost); elsewhere this is a plain download. */
async function openCache(): Promise<Cache | null> {
  try {
    if (typeof caches === 'undefined') return null
    return await caches.open(CACHE_NAME)
  } catch {
    return null
  }
}

let pruned = false
async function pruneOldCaches(): Promise<void> {
  if (pruned || typeof caches === 'undefined') return
  pruned = true
  try {
    for (const name of await caches.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) await caches.delete(name)
    }
  } catch {
    // best effort
  }
}

const inflight = new Map<string, Promise<Uint8Array>>()

/** The file's bytes: from the device cache when it is there and intact, else downloaded, checked and cached.
 * Concurrent calls for one file share one download. */
export function loadModelFile(url: string, expectedSha256: string): Promise<Uint8Array> {
  const key = `${url}#${expectedSha256}`
  const pending = inflight.get(key)
  if (pending) return pending
  const p = load(url, expectedSha256).finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

async function load(url: string, expectedSha256: string): Promise<Uint8Array> {
  void pruneOldCaches()
  const cache = await openCache()
  const hit = await cache?.match(url).catch(() => undefined)
  if (hit) {
    const bytes = new Uint8Array(await hit.arrayBuffer())
    if ((await sha256(bytes)) === expectedSha256) return bytes
    await cache?.delete(url).catch(() => false)
  }
  const res = await fetch(url)
  if (!res.ok) throw new Error(`model download failed: ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  if ((await sha256(bytes)) !== expectedSha256) throw new Error('model file does not match its checksum')
  try {
    await cache?.put(url, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }))
  } catch {
    // Out of quota or storage blocked: it still works, it just downloads again next time.
  }
  return bytes
}
