### Task 8: Wire the editor

**Files:**
- Create: `apps/web/features/interview-live/work/editorIntegrity.ts`
- Test: `apps/web/features/interview-live/work/editorIntegrity.test.ts`, `CodeEditor.options.test.tsx`
- Modify: `apps/web/features/interview-live/work/CodeEditor.tsx`

**Interfaces:**
- Consumes: `createProvenance` (Task 4); `createCadence`, `classifyKey` (Task 5); `attachEditorClipboard`, `ClipboardEditor`, `ForeignInsert` (Task 3); `clipboardRulesActive` (Task 2); `useProctorActions` (Task 7); `attachCodeActivity`'s new `classify` argument (Task 4).
- Produces: `NO_ASSIST_OPTIONS`, `CLIPBOARD_RULE_OPTIONS` (Monaco option objects); `ContentChangeEvent`, `IntegrityEditor`, `IntegrityMonaco`, `IntegrityDeps`; `attachEditorIntegrity(editor, monaco, deps): EditorIntegrity` where `EditorIntegrity { classify(change: { text: string }, event: { isUndoing?: boolean; isRedoing?: boolean }): EditVia; dispose(): void }`.

- [ ] **Step 1: Write the failing tests**

Create `editorIntegrity.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebMessageBody } from '../protocol/messages'
import { resetClipboard } from '../proctor/localClipboard'
import { CLIPBOARD_RULE_OPTIONS, NO_ASSIST_OPTIONS, attachEditorIntegrity, type ContentChangeEvent, type IntegrityEditor } from './editorIntegrity'

const monaco = { KeyCode: { F1: 59, Space: 10 }, KeyMod: { CtrlCmd: 2048 } }

function setup(over: { ignoring?: boolean; interviewerEditing?: boolean } = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const handlers: { content?: (e: ContentChangeEvent) => void } = {}
  const commands: number[] = []
  const editor: IntegrityEditor = {
    getDomNode: () => host,
    addCommand: (key: number) => { commands.push(key); return 'id' },
    onDidChangeModelContent: (cb) => { handlers.content = cb; return { dispose: vi.fn() } },
    getSelections: () => [],
    getModel: () => null,
    executeEdits: vi.fn(() => true),
    pushUndoStop: vi.fn(() => true),
    trigger: vi.fn(),
  }
  const sent: WebMessageBody[] = []
  const onForeign = vi.fn()
  const integrity = attachEditorIntegrity(editor, monaco, {
    send: (m) => sent.push(m),
    interviewerEditing: () => over.interviewerEditing ?? false,
    ignoring: () => over.ignoring ?? false,
    onForeign,
  })
  const key = (type: 'keydown' | 'keyup', init: KeyboardEventInit = {}) =>
    host.dispatchEvent(new KeyboardEvent(type, { key: 'a', code: 'KeyA', bubbles: true, ...init }))
  const change = (text: string, extra: Partial<ContentChangeEvent> = {}) =>
    handlers.content!({ changes: [{ range: { startLineNumber: 1 }, text }], isFlush: false, ...extra })
  const windows = () => sent.filter((m) => m.type === 'typing.window')
  return { host, commands, editor, sent, onForeign, integrity, key, change, windows }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  resetClipboard()
  document.body.innerHTML = ''
})

describe('attachEditorIntegrity', () => {
  it('switches off the command palette and the manual suggestion popup', () => {
    const { commands, integrity } = setup()
    expect(commands).toEqual([monaco.KeyCode.F1, monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space])
    integrity.dispose()
  })

  it('reports keys that a script, not a keyboard, produced as synthetic', () => {
    const { key, integrity, windows } = setup()
    for (let i = 0; i < 6; i++) { key('keydown'); key('keyup') }   // dispatched by script: isTrusted is false
    integrity.dispose()
    expect(windows()).toEqual([expect.objectContaining({ type: 'typing.window', keys: 6, untrusted: 6 })])
  })

  it('does not take a held key for a rhythm', () => {
    const { key, integrity, windows } = setup()
    for (let i = 0; i < 5; i++) key('keydown', { repeat: true })
    integrity.dispose()
    expect(windows()).toHaveLength(0)
  })

  it('counts typed characters, and long text that arrived with no key as injected', () => {
    const { key, change, integrity, windows } = setup()
    key('keydown')
    change('a')
    change('x'.repeat(45))
    integrity.dispose()
    expect(windows()).toEqual([expect.objectContaining({ keys: 1, chars: 1, charless: 45 })])
  })

  it('does not take undo, redo, a flush, the interviewer or the starter swap for injected text', () => {
    for (const over of [{ interviewerEditing: true }, { ignoring: true }]) {
      const { change, integrity, windows } = setup(over)
      change('x'.repeat(100))
      integrity.dispose()
      expect(windows()).toHaveLength(0)
    }
    const { change, integrity, windows } = setup()
    change('x'.repeat(100), { isUndoing: true })
    change('x'.repeat(100), { isRedoing: true })
    change('x'.repeat(100), { isFlush: true })
    integrity.dispose()
    expect(windows()).toHaveLength(0)
  })

  it('tags edits for the activity stream by how they arrived', () => {
    const { key, integrity } = setup()
    expect(integrity.classify({ text: 'x' }, {})).toBe('other')
    key('keydown')
    expect(integrity.classify({ text: 'x' }, {})).toBe('typed')
    expect(integrity.classify({ text: 'x' }, { isUndoing: true })).toBe('undo')
    integrity.dispose()
  })

  it('guards the clipboard only while the rules are active', () => {
    const paste = () => {
      const event = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', { value: { getData: () => 'def solve(): pass', setData: () => {} } })
      return event
    }

    vi.stubEnv('NODE_ENV', 'production')
    const live = setup()
    const blocked = paste()
    live.host.dispatchEvent(blocked)
    expect(blocked.defaultPrevented).toBe(true)
    expect(live.onForeign).toHaveBeenCalledWith({ source: 'paste', chars: 17, lines: 1 })
    live.integrity.dispose()

    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXT_PUBLIC_ENFORCE_CLIPBOARD', '')
    const dev = setup()
    const native = paste()
    dev.host.dispatchEvent(native)
    expect(native.defaultPrevented).toBe(false)
    expect(dev.onForeign).not.toHaveBeenCalled()
    dev.integrity.dispose()
  })

  it('sends what is left and stops listening once disposed', () => {
    const { key, integrity, windows, sent } = setup()
    key('keydown')
    integrity.dispose()
    expect(windows()).toHaveLength(1)
    const before = sent.length
    key('keydown')
    vi.advanceTimersByTime(20_000)
    expect(sent).toHaveLength(before)
  })
})

describe('editor options', () => {
  it('offers no completions, snippets or suggestions', () => {
    expect(NO_ASSIST_OPTIONS).toMatchObject({
      quickSuggestions: false, suggestOnTriggerCharacters: false, acceptSuggestionOnEnter: 'off', tabCompletion: 'off',
      snippetSuggestions: 'none', wordBasedSuggestions: 'off',
    })
  })

  it('closes the paste side doors: context menu, drop, paste-as and drag', () => {
    expect(CLIPBOARD_RULE_OPTIONS).toMatchObject({ contextmenu: false, dropIntoEditor: { enabled: false }, pasteAs: { enabled: false }, dragAndDrop: false })
  })
})
```

Create `CodeEditor.options.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MockLiveSession } from '../session/MockLiveSession'
import { WorkspaceProvider } from '../workspace/WorkspaceProvider'
import { CodeEditor } from './CodeEditor'

vi.mock('next/dynamic', () => ({ default: () => ({ options }: { options: object }) => <div data-testid="monaco" data-options={JSON.stringify(options)} /> }))
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'dark' }) }))

afterEach(() => { vi.unstubAllEnvs() })

function optionsOf(): Record<string, unknown> {
  const session = new MockLiveSession()
  render(<WorkspaceProvider session={session}><CodeEditor session={session} /></WorkspaceProvider>)
  return JSON.parse(screen.getByTestId('monaco').getAttribute('data-options')!)
}

describe('CodeEditor options', () => {
  it('never offers completions, even in dev', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXT_PUBLIC_ENFORCE_CLIPBOARD', '')
    expect(optionsOf()).toMatchObject({ quickSuggestions: false, snippetSuggestions: 'none', minimap: { enabled: false } })
  })

  it('leaves native paste, drop and the context menu alone in dev', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXT_PUBLIC_ENFORCE_CLIPBOARD', '')
    const options = optionsOf()
    expect(options).not.toHaveProperty('contextmenu')
    expect(options).not.toHaveProperty('dropIntoEditor')
  })

  it('closes the paste side doors in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(optionsOf()).toMatchObject({ contextmenu: false, dropIntoEditor: { enabled: false }, pasteAs: { enabled: false }, dragAndDrop: false })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail** (when the user has said to run tests)

Run (from `apps/web`): `pnpm exec vitest run features/interview-live/work/editorIntegrity.test.ts features/interview-live/work/CodeEditor.options.test.tsx`
Expected: FAIL (module not found; no options on the editor).

- [ ] **Step 3: Write `editorIntegrity.ts`**

```ts
/**
 * Everything one Monaco editor needs for the live integrity rules (spec §6): options that remove features which insert text
 * for the candidate, the clipboard guard, how each edit arrived, and the typing cadence. Typed against the slice of Monaco
 * it uses, so tests drive it with fakes.
 */
import { createProvenance } from '../activity/provenance'
import { classifyKey, createCadence } from '../proctor/cadence'
import { attachEditorClipboard, type ClipboardEditor, type ForeignInsert } from '../proctor/editorClipboard'
import { clipboardRulesActive } from '../proctor/localClipboard'
import type { EditVia, WebMessageBody } from '../protocol/messages'

/** Always on, dev included: nothing in the editor completes or inserts text the candidate did not type. */
export const NO_ASSIST_OPTIONS = {
  quickSuggestions: false,
  suggestOnTriggerCharacters: false,
  acceptSuggestionOnEnter: 'off',
  tabCompletion: 'off',
  snippetSuggestions: 'none',
  wordBasedSuggestions: 'off',
  parameterHints: { enabled: false },
  inlineSuggest: { enabled: false },
} as const

/** While the clipboard rules are active: no context-menu paste, no drag-drop, "paste as" or drag-move in the editor. */
export const CLIPBOARD_RULE_OPTIONS = {
  contextmenu: false,
  dropIntoEditor: { enabled: false },
  pasteAs: { enabled: false },
  dragAndDrop: false,
} as const

export interface ContentChangeEvent {
  changes: readonly { range: { startLineNumber: number }; text: string }[]
  isFlush: boolean
  isUndoing?: boolean
  isRedoing?: boolean
}

export interface IntegrityEditor extends ClipboardEditor {
  getDomNode(): HTMLElement | null
  addCommand(keybinding: number, handler: () => void): string | null
  onDidChangeModelContent(cb: (e: ContentChangeEvent) => void): { dispose(): void }
}

export interface IntegrityMonaco {
  KeyCode: { F1: number; Space: number }
  KeyMod: { CtrlCmd: number }
}

export interface IntegrityDeps {
  send(body: WebMessageBody): void
  /** True while the interviewer's own edit is being applied (the code adapter's `isApplying`). */
  interviewerEditing(): boolean
  /** True while a change is the starter text being swapped in: not the candidate's, and not reported. */
  ignoring(): boolean
  onForeign(info: ForeignInsert): void
  now?(): number
}

export interface EditorIntegrity {
  /** How a change arrived; the code activity stream tags its edit events with it. */
  classify(change: { text: string }, event: { isUndoing?: boolean; isRedoing?: boolean }): EditVia
  dispose(): void
}

export function attachEditorIntegrity(editor: IntegrityEditor, monaco: IntegrityMonaco, deps: IntegrityDeps): EditorIntegrity {
  const now = deps.now ?? Date.now
  const provenance = createProvenance({ now, interviewerEditing: deps.interviewerEditing })
  const cadence = createCadence({ now, send: (window) => deps.send({ type: 'typing.window', ...window }) })
  const disposers: (() => void)[] = []

  // The command palette and a manual suggestion popup are other ways to get text into the editor that was not typed.
  editor.addCommand(monaco.KeyCode.F1, () => {})
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space, () => {})

  const host = editor.getDomNode()
  if (host) {
    if (clipboardRulesActive()) {
      disposers.push(attachEditorClipboard(host, editor, { asLocalPaste: provenance.asLocalPaste, onForeign: deps.onForeign }))
    }
    const onKeyDown = (e: Event) => {
      const k = e as KeyboardEvent
      provenance.keyPressed()
      if (k.repeat) return // a held key is auto-repeat, not a rhythm
      cadence.keyDown({ cls: classifyKey(k), at: now(), code: k.code, trusted: k.isTrusted })
    }
    const onKeyUp = (e: Event) => cadence.keyUp((e as KeyboardEvent).code)
    host.addEventListener('keydown', onKeyDown, true)
    host.addEventListener('keyup', onKeyUp, true)
    disposers.push(() => {
      host.removeEventListener('keydown', onKeyDown, true)
      host.removeEventListener('keyup', onKeyUp, true)
    })
  }

  const content = editor.onDidChangeModelContent((e) => {
    if (e.isFlush || deps.ignoring()) return
    for (const change of e.changes) {
      const via = provenance.classify({ text: change.text, isUndoing: e.isUndoing, isRedoing: e.isRedoing })
      cadence.inserted(change.text.length, via, change.range.startLineNumber)
    }
  })
  disposers.push(() => content.dispose())

  return {
    classify: (change, event) => provenance.classify({ text: change.text, isUndoing: event.isUndoing, isRedoing: event.isRedoing }),
    dispose() {
      disposers.forEach((d) => d())
      cadence.stop()
    },
  }
}
```

- [ ] **Step 4: Wire `CodeEditor.tsx`**

Add the imports (next to the existing `../activity/...` imports):

```tsx
import { clipboardRulesActive } from '../proctor/localClipboard'
import { useProctorActions } from '../proctor/ProctorContext'
import { CLIPBOARD_RULE_OPTIONS, NO_ASSIST_OPTIONS, attachEditorIntegrity, type EditorIntegrity, type IntegrityEditor, type IntegrityMonaco } from './editorIntegrity'
```

Inside `CodeEditor`, after `const starterSwap = …` add:

```tsx
  const { foreignPaste } = useProctorActions()
  const foreignRef = useRef(foreignPaste)
  const integrity = useRef<EditorIntegrity | null>(null)
  useEffect(() => { foreignRef.current = foreignPaste }, [foreignPaste])
```

Replace the unmount effect with:

```tsx
  useEffect(() => () => { registerCode(null); detachActivity.current?.(); integrity.current?.dispose() }, [registerCode])
```

Change `const onMount: OnMount = (editor) => {` to `const onMount: OnMount = (editor, monaco) => {` and replace the tail of `onMount` (from `registerCode(codeApi)` to the closing of the function):

```tsx
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
```

Replace the `options` prop of `<Editor>`:

```tsx
          options={{
            minimap: { enabled: false }, fontSize: 14, automaticLayout: true, scrollBeyondLastLine: false, padding: { top: 12 }, glyphMargin: true,
            ...NO_ASSIST_OPTIONS,
            ...(clipboardRulesActive() ? CLIPBOARD_RULE_OPTIONS : {}),
          }}
```

Update the component's doc comment: append "It also tags how each edit arrived, reports typing cadence, and, in production, keeps copy and paste inside the room (live integrity spec §6)."

- [ ] **Step 5: Run the tests to verify they pass** (when the user has said to run tests)

Run (from `apps/web`): `pnpm exec vitest run features/interview-live/work features/interview-live/activity features/interview-live/proctor`
Expected: PASS, including the existing `CodeEditor`, `codeApi` and `WorkArea` tests.

- [ ] **Step 6: Leave the files in the working tree** (no commit): `editorIntegrity.ts`, `CodeEditor.tsx`, the two new test files.

---

