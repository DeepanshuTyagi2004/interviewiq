/**
 * Owns copy, cut, paste and drop for the editor while the clipboard rules are active (live integrity spec §6.1).
 * Capture-phase listeners on the editor's DOM node cancel the event before Monaco sees it, so nothing but the room's own
 * buffer can reach the code. Typed against the slice of the editor it uses, so tests drive it with a fake.
 */
import { bufferIsWholeLine, copyToRoom, getBuffer, judgePaste } from './localClipboard'

export interface ClipRange {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}
export interface ClipSelection extends ClipRange {
  isEmpty(): boolean
}
export interface ClipboardEditor {
  getSelections(): readonly ClipSelection[] | null
  getModel(): { getValueInRange(range: ClipRange): string; getLineMaxColumn(line: number): number; getLineCount(): number } | null
  executeEdits(source: string, edits: { range: ClipRange; text: string }[]): boolean
  pushUndoStop(): boolean
  trigger(source: string, handlerId: string, payload: unknown): void
}

/** Text that did not come from inside the room: how it arrived and how big it was, never what it said. */
export interface ForeignInsert {
  source: 'paste' | 'drop'
  chars: number
  lines: number
}
export interface EditorClipboardDeps {
  /** Runs `fn` while the editor's changes are the candidate's own local paste, so they are tagged `local_paste`. */
  asLocalPaste(fn: () => void): void
  onForeign(info: ForeignInsert): void
}

const lineCount = (text: string) => text.split(/\r\n|\r|\n/).length

/** What a copy takes: each selection joined by a line break; an empty selection takes its whole line, like the editor does. */
export function selectedText(editor: ClipboardEditor): { text: string; ranges: ClipRange[]; wholeLine: boolean } {
  const model = editor.getModel()
  const selections = editor.getSelections() ?? []
  if (!model || selections.length === 0) return { text: '', ranges: [], wholeLine: false }
  const ranges: ClipRange[] = selections.map((s) => {
    if (!s.isEmpty()) return s
    const line = s.startLineNumber
    return line >= model.getLineCount()
      ? { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: model.getLineMaxColumn(line) }
      : { startLineNumber: line, startColumn: 1, endLineNumber: line + 1, endColumn: 1 }
  })
  return { text: ranges.map((r) => model.getValueInRange(r)).join('\n'), ranges, wholeLine: selections.every((s) => s.isEmpty()) }
}

export function attachEditorClipboard(host: HTMLElement, editor: ClipboardEditor, deps: EditorClipboardDeps): () => void {
  const onCopy = (e: Event) => {
    const event = e as ClipboardEvent
    event.stopPropagation()
    const { text, wholeLine } = selectedText(editor)
    copyToRoom(text, event, wholeLine)
  }
  const onCut = (e: Event) => {
    const event = e as ClipboardEvent
    event.stopPropagation()
    const { text, ranges, wholeLine } = selectedText(editor)
    copyToRoom(text, event, wholeLine)
    if (text === '') return
    editor.pushUndoStop()
    editor.executeEdits('room-cut', ranges.map((range) => ({ range, text: '' })))
    editor.pushUndoStop()
  }
  const onPaste = (e: Event) => {
    const event = e as ClipboardEvent
    event.preventDefault()
    event.stopPropagation()
    const os = event.clipboardData?.getData('text/plain') ?? ''
    const verdict = judgePaste(os)
    if (verdict === 'local') {
      deps.asLocalPaste(() =>
        editor.trigger('room-clipboard', 'paste', { text: getBuffer(), pasteOnNewLine: bufferIsWholeLine(), multicursorText: null, mode: null }),
      )
    } else if (verdict === 'foreign') {
      deps.onForeign({ source: 'paste', chars: os.length, lines: lineCount(os) })
    }
  }
  const onDragOver = (e: Event) => {
    // dragover must stay cancelable so the drop event fires; the drop handler refuses it and reports its size.
    const event = e as DragEvent
    event.preventDefault()
    event.stopPropagation()
  }
  const onDrop = (e: Event) => {
    const event = e as DragEvent
    event.preventDefault()
    event.stopPropagation()
    const text = event.dataTransfer?.getData('text/plain') ?? ''
    if (text.trim() !== '') deps.onForeign({ source: 'drop', chars: text.length, lines: lineCount(text) })
  }
  const handlers: [string, (e: Event) => void][] = [['copy', onCopy], ['cut', onCut], ['paste', onPaste], ['dragover', onDragOver], ['drop', onDrop]]
  for (const [type, fn] of handlers) host.addEventListener(type, fn, true)
  return () => {
    for (const [type, fn] of handlers) host.removeEventListener(type, fn, true)
  }
}

/** Copy and cut anywhere else in the room (the problem panel, the conversation) also stay in the room. The editor has its
 * own guard, text fields keep native copy, and the whiteboard keeps its own clipboard (a known limit, spec §1). */
export function attachRoomCopyGuard(doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'getSelection'>): () => void {
  const onCopy = (e: Event) => {
    const target = e.target
    if (target instanceof Element && target.closest('.monaco-editor, .excalidraw, input, textarea, [contenteditable="true"]')) return
    copyToRoom(doc.getSelection()?.toString() ?? '', e as ClipboardEvent)
  }
  doc.addEventListener('copy', onCopy, true)
  doc.addEventListener('cut', onCopy, true)
  return () => {
    doc.removeEventListener('copy', onCopy, true)
    doc.removeEventListener('cut', onCopy, true)
  }
}
