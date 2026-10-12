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
    if (!clipboardRulesActive()) {
      // Dev keeps native paste and drop: text they insert is not "inserted with no key" (spec §6.1).
      const onDom = () => provenance.domInserted()
      host.addEventListener('paste', onDom, true)
      host.addEventListener('drop', onDom, true)
      disposers.push(() => {
        host.removeEventListener('paste', onDom, true)
        host.removeEventListener('drop', onDom, true)
      })
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
      const { via, keyed } = provenance.analyze({ text: change.text, isUndoing: e.isUndoing, isRedoing: e.isRedoing })
      cadence.inserted(change.text.length, via, change.range.startLineNumber, keyed)
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
