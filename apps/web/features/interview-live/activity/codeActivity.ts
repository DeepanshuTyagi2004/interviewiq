/**
 * Monaco → activity events (spec §5.1): what the candidate types, where the caret and selection are, and the
 * line under the pointer. Typed against the slice of the editor it uses, so tests drive it with a fake editor.
 * The interviewer's own edits (`isApplying`) and whole-model replacements (`isFlush`) are never the candidate's.
 */
import type { ActivityEventBody, EditVia } from '../protocol/messages'
import { capCodePoints } from './text'

export const MAX_INS = 200
const MAX_LINE_TEXT = 80
const MAX_SELECTED = 120

export interface ChangeLike {
  range: { startLineNumber: number; endLineNumber: number }
  text: string
  rangeLength: number
}
export interface SelectionLike {
  isEmpty(): boolean
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
  positionLineNumber: number
  positionColumn: number
}
export interface PositionLike {
  lineNumber: number
  column: number
}
interface Disposable {
  dispose(): void
}

export interface ContentEvent {
  changes: readonly ChangeLike[]
  isFlush: boolean
  isUndoing?: boolean
  isRedoing?: boolean
}

export interface ActivityEditor {
  getModel(): { getLineContent(line: number): string; getValueInRange(range: SelectionLike): string } | null
  getSelection(): SelectionLike | null
  onDidChangeModelContent(cb: (e: ContentEvent) => void): Disposable
  onDidChangeCursorSelection(cb: () => void): Disposable
  onMouseMove(cb: (e: { target: { position: PositionLike | null } }) => void): Disposable
  onDidFocusEditorText(cb: () => void): Disposable
}

/** The editor swaps its starter text when the candidate changes language before writing anything. The wrapper applies that
 * as an ordinary edit (not a flush), so without this it would be reported as the candidate typing a whole class. The
 * caller announces the swap with `expect`; `matches` is true while the editor still holds exactly that text (the swap's
 * own change and the cursor move after it) and turns false, for good, once the candidate changes it. */
export function createStarterSwapGuard() {
  let pending: string | null = null
  return {
    expect(text: string) {
      pending = text
    },
    matches(current: string): boolean {
      if (pending === null) return false
      if (current === pending) return true
      pending = null
      return false
    },
  }
}

export function editEvents(changes: readonly ChangeLike[], isFlush: boolean, via?: (change: ChangeLike) => EditVia): ActivityEventBody[] {
  if (isFlush) return []
  return changes.map((c) => ({
    k: 'edit' as const, from_line: c.range.startLineNumber, to_line: c.range.endLineNumber, ins: capCodePoints(c.text, MAX_INS), removed: c.rangeLength,
    ...(via ? { via: via(c) } : {}),
  }))
}

export function codePointer(position: PositionLike | null | undefined, lineText: (line: number) => string): ActivityEventBody | null {
  if (!position) return null
  return { k: 'ptr', s: 'code', line: position.lineNumber, col: position.column, text: capCodePoints(lineText(position.lineNumber).trim(), MAX_LINE_TEXT) }
}

export function caretEvent(sel: SelectionLike, textOf: (range: SelectionLike) => string): ActivityEventBody {
  const caret = { k: 'caret' as const, line: sel.positionLineNumber, col: sel.positionColumn }
  if (sel.isEmpty()) return caret
  return { ...caret, sel: [sel.startLineNumber, sel.endLineNumber], text: capCodePoints(textOf(sel), MAX_SELECTED) }
}

/** Starts reporting; the returned function stops. */
export function attachCodeActivity(
  editor: ActivityEditor,
  record: (e: ActivityEventBody) => void,
  isApplying: () => boolean,
  classify?: (change: ChangeLike, event: ContentEvent) => EditVia,
): () => void {
  const subs = [
    editor.onDidChangeModelContent((e) => {
      if (isApplying()) return
      for (const ev of editEvents(e.changes, e.isFlush, classify && ((c) => classify(c, e)))) record(ev)
    }),
    editor.onDidChangeCursorSelection(() => {
      if (isApplying()) return
      const sel = editor.getSelection()
      const model = editor.getModel()
      if (sel && model) record(caretEvent(sel, (r) => model.getValueInRange(r)))
    }),
    editor.onMouseMove((e) => {
      const model = editor.getModel()
      const ev = model ? codePointer(e.target.position, (n) => model.getLineContent(n)) : null
      if (ev) record(ev)
    }),
    editor.onDidFocusEditorText(() => record({ k: 'focus', s: 'code' })),
  ]
  return () => subs.forEach((s) => s.dispose())
}
