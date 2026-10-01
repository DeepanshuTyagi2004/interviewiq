'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef } from 'react'
import { useTheme } from 'next-themes'
import '@excalidraw/excalidraw/index.css'
import type { LiveSession } from '../session/types'
import { summarizeScene } from './summarizeScene'

const Excalidraw = dynamic(async () => (await import('@excalidraw/excalidraw')).Excalidraw, {
  ssr: false,
  loading: () => <div data-motion className="h-full animate-pulse bg-panel" />,
})

/** Excalidraw-backed whiteboard. Debounces scene changes ~800ms, summarizes the elements
 * into readable text via summarizeScene, and pushes a diagram artifact snapshot to the
 * session — the interviewer sees a text description, not raw scene JSON. */
export function DiagramBoard({ session }: { session: LiveSession }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Presentation only: the whiteboard follows the app's light/dark theme.
  const { resolvedTheme } = useTheme()

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  return (
    <div className="h-full">
      <Excalidraw
        theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
        onChange={(elements) => {
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => session.sendArtifact({ kind: 'diagram', content: summarizeScene(elements) }), 800)
        }}
      />
    </div>
  )
}
