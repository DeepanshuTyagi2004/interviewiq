'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import type { LiveSession } from '../session/types'

const Editor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => <div className="h-full bg-muted animate-pulse" />,
})

const LANGS = ['python', 'javascript', 'typescript', 'java', 'cpp', 'go'] as const

/** Monaco-backed code scratchpad. Debounces edits ~800ms before pushing a code artifact
 * snapshot to the session so the interviewer sees the candidate's latest work without
 * flooding the transport on every keystroke. */
export function CodeEditor({ session }: { session: LiveSession }) {
  const [value, setValue] = useState('# write your solution here\n')
  const [lang, setLang] = useState<(typeof LANGS)[number]>('python')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => session.sendArtifact({ kind: 'code', content: value, language: lang }), 800)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [value, lang, session])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b p-2">
        <select
          value={lang}
          onChange={(e) => setLang(e.target.value as (typeof LANGS)[number])}
          className="rounded border bg-background px-2 py-1 text-sm"
        >
          {LANGS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <div className="flex-1">
        <Editor
          height="100%"
          language={lang}
          theme="vs-dark"
          value={value}
          onChange={(v) => setValue(v ?? '')}
          options={{ minimap: { enabled: false }, fontSize: 14, automaticLayout: true }}
        />
      </div>
    </div>
  )
}
