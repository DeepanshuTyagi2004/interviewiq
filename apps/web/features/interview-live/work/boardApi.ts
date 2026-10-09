/**
 * Applies the interviewer's whiteboard actions to Excalidraw and produces what the agent reads (a PNG
 * snapshot, a compressed scene backup). The Excalidraw functions arrive as `deps`, so this module never
 * loads the browser-only library and tests drive it with fakes.
 */
import type { AgentMessageOf } from '../protocol/messages'
import { blockRect, drawOrigin, inVisibleArea, skeletonsFor, type SceneElement, type Skeleton } from '../workspace/board'
import type { AckResult, BoardApi } from '../workspace/WorkspaceProvider'

export interface ExcalidrawLike {
  getSceneElements(): readonly SceneElement[]
  getAppState(): Record<string, unknown>
  getFiles(): Record<string, unknown>
  updateScene(scene: { elements: readonly SceneElement[]; captureUpdate?: unknown }): void
  scrollToContent?(target?: readonly SceneElement[], opts?: { animate?: boolean }): void
}

export interface BoardDeps {
  convert(skeletons: Skeleton[]): SceneElement[]
  exportPng(opts: {
    elements: readonly SceneElement[]
    appState: Record<string, unknown>
    files: Record<string, unknown>
    maxWidthOrHeight: number
    mimeType: 'image/png'
  }): Promise<Blob>
  serialize(elements: readonly SceneElement[], appState: Record<string, unknown>, files: Record<string, unknown>): string
  restoreElements(elements: unknown[]): SceneElement[]
  /** Excalidraw's CaptureUpdateAction.IMMEDIATELY: makes interviewer drawings undoable. */
  captureUpdate: unknown
}

export const SNAPSHOT_MAX_SIDE = 1024

export interface ExcalidrawBoardApi extends BoardApi {
  exportBackup(): Promise<{ data: Uint8Array; encoding: 'gzip' | 'none' } | null>
}

const live = (elements: readonly SceneElement[]) => elements.filter((e) => !e.isDeleted)

/** Compression is an optimisation: where streaming Blobs or CompressionStream don't exist (older
 * browsers, jsdom) the backup goes uncompressed, and `encoding` says which. */
const canCompress = () =>
  typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined' && typeof Blob.prototype.stream === 'function'

async function gzip(bytes: Uint8Array): Promise<{ data: Uint8Array; encoding: 'gzip' | 'none' }> {
  if (!canCompress()) return { data: bytes, encoding: 'none' }
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'))
  return { data: new Uint8Array(await new Response(stream).arrayBuffer()), encoding: 'gzip' }
}

async function gunzip(bytes: Uint8Array, encoding: string | undefined): Promise<Uint8Array> {
  if (encoding !== 'gzip') return bytes
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export interface BoardHooks {
  /** Called right before a restored scene replaces the board, and only for a backup that read cleanly. */
  beforeRestore?(): void
}

export function createBoardApi(api: ExcalidrawLike, deps: BoardDeps, hooks: BoardHooks = {}): ExcalidrawBoardApi {
  return {
    draw(m: AgentMessageOf<'board.draw'>): AckResult {
      const existing = api.getSceneElements()
      const view = api.getAppState()
      const block = blockRect(m.elements)
      const origin = drawOrigin(live(existing), block, view)
      const added = deps
        .convert(skeletonsFor(m.elements, origin))
        .map((e) => ({ ...e, customData: { ...e.customData, author: 'interviewer' } }))
      api.updateScene({ elements: [...existing, ...added], captureUpdate: deps.captureUpdate })
      // No room in view, so it went beside everything: bring the board to it rather than leave it off screen.
      if (!inVisibleArea(block, origin, view)) api.scrollToContent?.(added, { animate: true })
      return { ok: true }
    },
    async snapshotPng() {
      const elements = live(api.getSceneElements())
      if (!elements.length) return null
      const blob = await deps.exportPng({
        elements,
        appState: { ...api.getAppState(), exportBackground: true },
        files: api.getFiles(),
        maxWidthOrHeight: SNAPSHOT_MAX_SIDE,
        mimeType: 'image/png',
      })
      return new Uint8Array(await blob.arrayBuffer())
    },
    async exportBackup() {
      const elements = live(api.getSceneElements())
      if (!elements.length) return null
      return gzip(new TextEncoder().encode(deps.serialize(elements, api.getAppState(), api.getFiles())))
    },
    async restore(data, attributes) {
      try {
        const json = JSON.parse(new TextDecoder().decode(await gunzip(data, attributes.encoding))) as { elements?: unknown[] }
        const elements = deps.restoreElements(json.elements ?? [])
        hooks.beforeRestore?.()
        api.updateScene({ elements, captureUpdate: deps.captureUpdate })
      } catch {
        // a corrupt backup leaves the board as it is
      }
    },
    hasContent: () => live(api.getSceneElements()).length > 0,
  }
}
