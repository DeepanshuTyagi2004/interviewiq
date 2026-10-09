import { describe, expect, it, vi } from 'vitest'
import { stampAgent, type AgentMessageOf } from '../protocol/messages'
import { INTERVIEWER_STROKE, SIDE_MARGIN, TOOLBAR_CLEARANCE, type SceneElement } from '../workspace/board'
import { SNAPSHOT_MAX_SIDE, createBoardApi, type BoardDeps, type ExcalidrawLike } from './boardApi'

function fakeBoard(elements: SceneElement[] = []) {
  const state = { elements }
  const api: ExcalidrawLike = {
    getSceneElements: () => state.elements,
    getAppState: () => ({ viewBackgroundColor: '#fff' }),
    getFiles: () => ({}),
    updateScene: vi.fn((scene) => { state.elements = [...scene.elements] }),
  }
  const deps: BoardDeps = {
    convert: vi.fn((skeletons: Record<string, unknown>[]) => skeletons.map((s) => ({ ...(s as object), id: String(s.id), type: String(s.type) }) as SceneElement)),
    exportPng: vi.fn(async () => ({ arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer }) as unknown as Blob),
    serialize: (els) => JSON.stringify({ type: 'excalidraw', elements: els }),
    restoreElements: (els) => els as SceneElement[],
    captureUpdate: 'IMMEDIATELY',
  }
  return { api, deps, state }
}

const draw = stampAgent({ type: 'board.draw', elements: [{ type: 'rectangle', id: 'n1', label: 'Client' }] }) as AgentMessageOf<'board.draw'>

describe('createBoardApi', () => {
  it('draws interviewer shapes beside the candidate drawing, tagged and undoable', () => {
    const { api, deps, state } = fakeBoard([{ id: 'c1', type: 'rectangle', x: 0, y: 0, width: 100, height: 40 }])
    expect(createBoardApi(api, deps).draw(draw)).toEqual({ ok: true })
    const skeleton = (deps.convert as ReturnType<typeof vi.fn>).mock.calls[0][0][0]
    expect(skeleton).toMatchObject({ x: 180, strokeColor: INTERVIEWER_STROKE })
    expect(state.elements.at(-1)?.customData).toEqual({ author: 'interviewer' })
    expect(api.updateScene).toHaveBeenCalledWith(expect.objectContaining({ captureUpdate: 'IMMEDIATELY' }))
  })

  it('draws on an empty board below the toolbar at the top of the view, not at the canvas corner', () => {
    const { api, deps } = fakeBoard()
    createBoardApi(api, deps).draw(draw)
    expect((deps.convert as ReturnType<typeof vi.fn>).mock.calls[0][0][0]).toMatchObject({ x: SIDE_MARGIN, y: TOOLBAR_CLEARANCE })
  })

  it('never draws over the candidate, using empty space inside the view', () => {
    const view = { scrollX: 0, scrollY: 0, zoom: { value: 1 }, width: 1000, height: 700 }
    const mine: SceneElement[] = [
      { id: 'c1', type: 'rectangle', x: 32, y: 96, width: 400, height: 300 },
      { id: 'c2', type: 'ellipse', x: 480, y: 96, width: 200, height: 200 },
    ]
    const { api, deps } = fakeBoard(mine)
    api.getAppState = () => view
    createBoardApi(api, deps).draw(draw)
    const sk = (deps.convert as ReturnType<typeof vi.fn>).mock.calls[0][0][0] as { x: number; y: number; width: number; height: number }
    const hits = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
      a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
    expect(mine.some((e) => hits(sk, { x: e.x!, y: e.y!, width: e.width!, height: e.height! }))).toBe(false)
    expect(sk.x + sk.width).toBeLessThanOrEqual(view.width)          // and it is on screen, not off to the right
  })

  it('scrolls the board to the drawing when the view had no room and it had to go off to the side', () => {
    const view = { scrollX: 0, scrollY: 0, zoom: { value: 1 }, width: 1000, height: 700 }
    const { api, deps } = fakeBoard([{ id: 'wall', type: 'rectangle', x: 0, y: 0, width: 3000, height: 3000 }])
    api.getAppState = () => view
    const scroll = vi.fn()
    api.scrollToContent = scroll
    createBoardApi(api, deps).draw(draw)
    expect(scroll).toHaveBeenCalledTimes(1)
    expect(scroll.mock.calls[0][0].map((e: SceneElement) => e.id)).toEqual(['n1'])
  })

  it('leaves the candidate\'s view alone when the drawing fits in it', () => {
    const view = { scrollX: 0, scrollY: 0, zoom: { value: 1 }, width: 1000, height: 700 }
    const { api, deps } = fakeBoard([{ id: 'c1', type: 'rectangle', x: 32, y: 96, width: 100, height: 60 }])
    api.getAppState = () => view
    const scroll = vi.fn()
    api.scrollToContent = scroll
    createBoardApi(api, deps).draw(draw)
    expect(scroll).not.toHaveBeenCalled()
  })

  it('follows where the candidate has scrolled the board to', () => {
    const { api, deps } = fakeBoard()
    api.getAppState = () => ({ scrollX: -500, scrollY: -300, zoom: { value: 1 }, width: 1000, height: 700 })
    createBoardApi(api, deps).draw(draw)
    expect((deps.convert as ReturnType<typeof vi.fn>).mock.calls[0][0][0]).toMatchObject({ x: 500 + SIDE_MARGIN, y: 300 + TOOLBAR_CLEARANCE })
  })

  it('tells its caller right before a restored scene is applied (not when it starts reading it), and not for a corrupt backup', async () => {
    const order: string[] = []
    const source = fakeBoard([{ id: 'c1', type: 'diamond', x: 0, y: 0 }])
    const backup = await createBoardApi(source.api, source.deps).exportBackup()
    const target = fakeBoard()
    const updateScene = target.api.updateScene
    target.api.updateScene = vi.fn((scene) => { order.push('update'); updateScene(scene) })
    const board = createBoardApi(target.api, target.deps, { beforeRestore: () => order.push('before') })
    await board.restore(backup!.data, { encoding: backup!.encoding })
    expect(order).toEqual(['before', 'update'])
    order.length = 0
    await board.restore(new Uint8Array([1, 2, 3]), { encoding: 'none' })
    expect(order).toEqual([])
  })

  it('exports a PNG no larger than 1024px, and nothing for an empty board', async () => {
    const empty = fakeBoard()
    expect(await createBoardApi(empty.api, empty.deps).snapshotPng()).toBeNull()
    const { api, deps } = fakeBoard([{ id: 'c1', type: 'ellipse', x: 0, y: 0 }])
    const png = await createBoardApi(api, deps).snapshotPng()
    expect(png).toEqual(new Uint8Array([137, 80, 78, 71]))
    expect(deps.exportPng).toHaveBeenCalledWith(expect.objectContaining({ maxWidthOrHeight: SNAPSHOT_MAX_SIDE, mimeType: 'image/png' }))
  })

  it('round-trips a backup through restore and ignores a corrupt one', async () => {
    const source = fakeBoard([{ id: 'c1', type: 'diamond', x: 0, y: 0 }])
    const backup = await createBoardApi(source.api, source.deps).exportBackup()
    expect(backup).not.toBeNull()
    const target = fakeBoard()
    const board = createBoardApi(target.api, target.deps)
    await board.restore(backup!.data, { encoding: backup!.encoding })
    expect(target.state.elements.map((e) => e.id)).toEqual(['c1'])
    await expect(board.restore(new Uint8Array([1, 2, 3]), { encoding: 'none' })).resolves.toBeUndefined()
  })
})
