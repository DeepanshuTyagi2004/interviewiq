'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import '@excalidraw/excalidraw/index.css'
import { useActivity } from '../activity/ActivityProvider'
import { createHitTester, shapeEvents, type ShapeIndex } from '../activity/boardActivity'
import type { LiveSession } from '../session/types'
import { sceneVersion, selectionSummary, summarizeScene, type SceneElement } from '../workspace/board'
import { useWorkspace } from '../workspace/WorkspaceProvider'
import { createBoardApi, type ExcalidrawBoardApi, type ExcalidrawLike } from './boardApi'

const Excalidraw = dynamic(async () => (await import('@excalidraw/excalidraw')).Excalidraw, {
  ssr: false,
  loading: () => <div data-motion className="h-full animate-pulse bg-surface" />,
})

type ExcalidrawProps = React.ComponentProps<typeof import('@excalidraw/excalidraw').Excalidraw>
type ExcalidrawApi = Parameters<NonNullable<ExcalidrawProps['excalidrawAPI']>>[0]

export const SUMMARY_DEBOUNCE_MS = 800
export const BACKUP_INTERVAL_MS = 10_000

/** The shared Excalidraw whiteboard. Sends a text summary when the board settles and a compressed
 * backup every 10 s while it changes; registers the adapter that draws for the interviewer and
 * answers snapshot requests; offers Ask about selected shapes. */
export function DiagramBoard({ session }: { session: LiveSession }) {
  const { registerBoard, askAbout } = useWorkspace()
  const { record } = useActivity()
  const shapes = useRef<ShapeIndex | null>(null)
  const hitTest = useRef(createHitTester())
  const { resolvedTheme } = useTheme()
  const raw = useRef<ExcalidrawApi | null>(null)
  const board = useRef<ExcalidrawBoardApi | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const version = useRef(0)
  const lastSummary = useRef('')
  const lastBackup = useRef(-1)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
    registerBoard(null)
  }, [registerBoard])

  useEffect(() => {
    const id = setInterval(() => {
      const ex = raw.current
      const b = board.current
      if (!ex || !b) return
      const v = sceneVersion(ex.getSceneElements() as unknown as SceneElement[])
      if (v === lastBackup.current) return
      lastBackup.current = v
      void b.exportBackup().then((backup) => {
        if (backup) void session.sendBytes('board.backup', backup.data, { encoding: backup.encoding })
      })
    }, BACKUP_INTERVAL_MS)
    return () => clearInterval(id)
  }, [session])

  async function onApi(ex: ExcalidrawApi) {
    raw.current = ex
    const lib = await import('@excalidraw/excalidraw')
    // A restored scene is not the candidate drawing: the next change starts a new baseline. Reset just before the
    // scene is applied, not when the restore starts, so drawing during the read is still reported.
    const adapter = createBoardApi(ex as unknown as ExcalidrawLike, {
      convert: (skeletons) => lib.convertToExcalidrawElements(skeletons as never) as unknown as SceneElement[],
      exportPng: (opts) => lib.exportToBlob(opts as never),
      serialize: (elements, appState, files) => lib.serializeAsJSON(elements as never, appState as never, files as never, 'local'),
      restoreElements: (elements) => lib.restoreElements(elements as never, null) as unknown as SceneElement[],
      captureUpdate: lib.CaptureUpdateAction.IMMEDIATELY,
    }, { beforeRestore: () => { shapes.current = null } })
    board.current = adapter
    registerBoard(adapter)
  }

  return (
    <div className="relative h-full">
      <Excalidraw
        theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
        excalidrawAPI={(ex) => void onApi(ex)}
        onChange={(elements, appState) => {
          const ids = appState.selectedElementIds as Record<string, boolean>
          setSelected(Object.keys(ids).length ? selectionSummary(elements, ids) : null)
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => {
            const text = summarizeScene(elements)
            if (text === lastSummary.current) return
            lastSummary.current = text
            version.current += 1
            session.send({ type: 'board.summary', version: version.current, text })
          }, SUMMARY_DEBOUNCE_MS)
          const { events, next } = shapeEvents(shapes.current, elements as unknown as readonly SceneElement[])
          shapes.current = next
          for (const ev of events) record(ev)
        }}
        onPointerUpdate={({ pointer }) => {
          const els = raw.current?.getSceneElements() as unknown as readonly SceneElement[] | undefined
          const over = els ? hitTest.current(els, pointer.x, pointer.y) : undefined
          record({ k: 'ptr', s: 'board', x: Math.round(pointer.x), y: Math.round(pointer.y), ...(over ? { over } : {}) })
        }}
      />
      {selected ? (
        <button
          type="button"
          onClick={() => {
            askAbout({ surface: 'board', quote: selected })
            setSelected(null)
          }}
          className="absolute right-3 top-14 z-10 h-8 rounded-full bg-foreground px-3 text-[12.5px] text-background shadow-hero"
        >
          Ask about selection
        </button>
      ) : null}
    </div>
  )
}
