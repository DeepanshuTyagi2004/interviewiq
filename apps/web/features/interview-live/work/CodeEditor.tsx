'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { CustomSelect } from '@/components/ui/custom-select'
import type { LiveSession } from '../session/types'

const Editor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => <div data-motion className="h-full animate-pulse bg-panel" />,
})

const LANGS = ['python', 'javascript', 'typescript', 'java', 'cpp', 'go'] as const

/** Monaco-backed code scratchpad. Debounces edits ~800ms before pushing a code artifact
 * snapshot to the session so the interviewer sees the candidate's latest work without
 * flooding the transport on every keystroke. */
export function CodeEditor({ session }: { session: LiveSession }) {
  const [value, setValue] = useState('# write your solution here\n')
  const [lang, setLang] = useState<(typeof LANGS)[number]>('python')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Presentation only: Monaco follows the app's light/dark theme.
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => session.sendArtifact({ kind: 'code', content: value, language: lang }), 800)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [value, lang, session])

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
        <label htmlFor="code-language" className="sr-only">
          Language
        </label>
        <CustomSelect
          id="code-language"
          label="Language"
          value={lang}
          onValueChange={(value) => { const language = LANGS.find((item) => item === value); if (language) setLang(language) }}
          options={LANGS.map((language) => ({ value: language, label: language }))}
          className="h-7 w-auto rounded-full border border-line-3 bg-card px-2.5 font-mono text-[12px] text-foreground transition-colors hover:border-faint-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>
      <div className="flex-1">
        <Editor
          height="100%"
          language={lang}
          theme={resolvedTheme === 'dark' ? 'vs-dark' : 'light'}
          value={value}
          onChange={(v) => setValue(v ?? '')}
          options={{ minimap: { enabled: false }, fontSize: 14, automaticLayout: true, scrollBeyondLastLine: false, padding: { top: 12 } }}
        />
      </div>
    </div>
  )
}
