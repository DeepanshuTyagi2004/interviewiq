'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import type { OnMount } from '@monaco-editor/react'
import { CustomSelect } from '@/components/ui/custom-select'
import { useActivity } from '../activity/ActivityProvider'
import { attachCodeActivity, createStarterSwapGuard, type ActivityEditor } from '../activity/codeActivity'
import type { LiveSession } from '../session/types'
import { LANGUAGES, starterText, type Language } from '../workspace/codeOps'
import { clipboardRulesActive } from '../proctor/localClipboard'
import { useProctorActions } from '../proctor/ProctorContext'
import { useWorkspace } from '../workspace/WorkspaceProvider'
import { defineIqThemes } from './monacoThemes'
import { createCodeApi, type EditorCodeApi } from './codeApi'
import { CLIPBOARD_RULE_OPTIONS, NO_ASSIST_OPTIONS, attachEditorIntegrity, type EditorIntegrity, type IntegrityEditor, type IntegrityMonaco } from './editorIntegrity'

const Editor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => <div data-motion className="h-full animate-pulse bg-surface" />,
})

export const SNAPSHOT_DEBOUNCE_MS = 800

const toolButton = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background h-7 rounded-full border border-line-3 px-2.5 text-[12px] text-foreground transition-colors hover:border-faint-2'

/** The shared Monaco editor. Sends a `code.snapshot` 800ms after typing stops; registers the code
 * adapter that applies the interviewer's comments, inserts and highlights; lets the candidate
 * highlight lines or ask about a selection. It also tags how each edit arrived, reports typing cadence, and, in production,
 * keeps copy and paste inside the room (live integrity spec §6). */
export function CodeEditor({ session }: { session: LiveSession }) {
  const { registerCode, askAbout } = useWorkspace()
  const { record } = useActivity()
  const detachActivity = useRef<(() => void) | null>(null)
  const starterSwap = useRef(createStarterSwapGuard())
  const { foreignPaste } = useProctorActions()
  const foreignRef = useRef(foreignPaste)
  const integrity = useRef<EditorIntegrity | null>(null)
  const [lang, setLang] = useState<Language>('python')
  const [value, setValue] = useState(() => starterText('python'))
  const [selection, setSelection] = useState<{ start: number; end: number; text: string } | null>(null)
  const langRef = useRef(lang)
  const api = useRef<EditorCodeApi | null>(null)
  const version = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Presentation only: Monaco follows the app's light/dark theme.
  const { resolvedTheme } = useTheme()

  useEffect(() => { langRef.current = lang }, [lang])
  useEffect(() => { foreignRef.current = foreignPaste }, [foreignPaste])
  useEffect(() => () => { registerCode(null); detachActivity.current?.(); integrity.current?.dispose() }, [registerCode])

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      version.current += 1
      session.send({ type: 'code.snapshot', version: version.current, language: lang, text: value })
    }, SNAPSHOT_DEBOUNCE_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [value, lang, session])

  const onMount: OnMount = (editor, monaco) => {
    const codeApi = createCodeApi(editor, () => langRef.current, (l) => setLang(l))
    api.current = codeApi
    editor.onDidChangeModelContent((e) => {
      if (!codeApi.isApplying()) codeApi.onEdited(e.changes.map((c) => c.range))
    })
    editor.onDidChangeCursorSelection(() => {
      const sel = editor.getSelection()
      const model = editor.getModel()
      if (!sel || !model || sel.isEmpty()) return setSelection(null)
      setSelection({ start: sel.startLineNumber, end: sel.endLineNumber, text: model.getValueInRange(sel) })
    })
    registerCode(codeApi)
    integrity.current?.dispose()
    const guard = attachEditorIntegrity(editor as unknown as IntegrityEditor, monaco as unknown as IntegrityMonaco, {
      send: (body) => {
        try {
          session.send(body)
        } catch {
          // disconnected: this stretch of typing is simply lost, the round goes on
        }
      },
      interviewerEditing: () => codeApi.isApplying(),
      ignoring: () => starterSwap.current.matches(editor.getModel()?.getValue() ?? ''),
      onForeign: (info) => foreignRef.current(info),
    })
    integrity.current = guard
    detachActivity.current?.()
    detachActivity.current = attachCodeActivity(
      editor as unknown as ActivityEditor,
      record,
      () => codeApi.isApplying() || starterSwap.current.matches(editor.getModel()?.getValue() ?? ''),
      guard.classify,
    )
  }

  function changeLanguage(next: Language) {
    if (value === starterText(lang)) {
      starterSwap.current.expect(starterText(next))
      setValue(starterText(next))
    }
    setLang(next)
  }

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
          onValueChange={(v) => { const next = LANGUAGES.find((item) => item === v); if (next) changeLanguage(next) }}
          options={LANGUAGES.map((language) => ({ value: language, label: language }))}
          className="h-7 w-auto rounded-full border border-line-3 bg-card px-2.5 font-mono text-[12px] text-foreground transition-colors hover:border-faint-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
        {selection ? (
          <div role="toolbar" aria-label="Code selection" className="ml-auto flex items-center gap-1">
            <button
              type="button"
              className={toolButton}
              onClick={() => {
                api.current?.markCandidate(selection.start, selection.end)
                session.send({ type: 'code.highlight_added', start_line: selection.start, end_line: selection.end, text: selection.text.slice(0, 4000) })
              }}
            >
              Highlight lines
            </button>
            <button
              type="button"
              className="h-7 rounded-full bg-foreground px-3 text-[12px] text-background"
              onClick={() => askAbout({ surface: 'code', quote: selection.text.slice(0, 4000) || `lines ${selection.start}-${selection.end}`, lines: [selection.start, selection.end] })}
            >
              Ask
            </button>
          </div>
        ) : null}
      </div>
      <div className="flex-1">
        <Editor
          height="100%"
          language={lang}
          theme={resolvedTheme === 'dark' ? 'iq-dark' : 'iq-light'}
          beforeMount={defineIqThemes}
          value={value}
          onChange={(v) => setValue(v ?? '')}
          onMount={onMount}
          options={{
            minimap: { enabled: false }, fontSize: 14, automaticLayout: true, scrollBeyondLastLine: false, padding: { top: 12 }, glyphMargin: true,
            ...NO_ASSIST_OPTIONS,
            ...(clipboardRulesActive() ? CLIPBOARD_RULE_OPTIONS : {}),
          }}
        />
      </div>
    </div>
  )
}
