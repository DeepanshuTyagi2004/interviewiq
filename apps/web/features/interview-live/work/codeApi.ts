/**
 * Applies the interviewer's code instructions to Monaco (spec §6.4). Typed against the small slice of
 * the editor API it uses, so tests drive it with a fake editor.
 */
import type { AgentMessageOf, CodeLanguage, LineAnchor } from '../protocol/messages'
import { insertionText, overlaps, resolveLine, starterText, type Language } from '../workspace/codeOps'
import type { AckResult, CodeApi, CodeInstruction } from '../workspace/WorkspaceProvider'

export interface RangeLike {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

export interface DecorationLike {
  range: RangeLike
  options: { isWholeLine?: boolean; className?: string; glyphMarginClassName?: string; hoverMessage?: { value: string } }
}

export interface ModelLike {
  getLinesContent(): string[]
  getValue(): string
  setValue(value: string): void
  getDecorationRange(id: string): RangeLike | null
}

export interface EditorLike {
  getModel(): ModelLike | null
  executeEdits(source: string, edits: { range: RangeLike; text: string; forceMoveMarkers?: boolean }[]): boolean
  pushUndoStop(): boolean
  deltaDecorations(oldIds: string[], next: DecorationLike[]): string[]
}

export const AGENT_LINE_CLASS = 'iq-agent-line'
export const AGENT_GLYPH_CLASS = 'iq-agent-glyph'
export const AGENT_HIGHLIGHT_CLASS = 'iq-agent-highlight'
export const CANDIDATE_HIGHLIGHT_CLASS = 'iq-cand-highlight'

const atLine = (n: number): RangeLike => ({ startLineNumber: n, startColumn: 1, endLineNumber: n, endColumn: 1 })
const lines = (a: number, b: number): RangeLike => ({ startLineNumber: a, startColumn: 1, endLineNumber: b, endColumn: 1 })

export interface EditorCodeApi extends CodeApi {
  /** Drops interviewer highlights on lines the candidate just edited. */
  onEdited(ranges: RangeLike[]): void
  /** Marks lines the candidate highlighted. */
  markCandidate(start: number, end: number): void
  /** True while this adapter's own edit runs, so the editor ignores its change event. */
  isApplying(): boolean
}

export function createCodeApi(
  editor: EditorLike,
  getLanguage: () => Language,
  setLanguage: (language: CodeLanguage) => void,
): EditorCodeApi {
  const highlights = new Map<string, string[]>()
  let candidate: string[] = []
  let applying = false

  function insert(at: LineAnchor, text: string): AckResult {
    const model = editor.getModel()
    if (!model) return { ok: false, reason: 'editor_not_ready' }
    const target = resolveLine(model.getLinesContent(), at)
    if (target === null) return { ok: false, reason: 'line_changed' }
    const count = text.split('\n').length - 1
    editor.pushUndoStop()
    applying = true
    try {
      editor.executeEdits('interviewer', [{ range: atLine(target), text, forceMoveMarkers: true }])
    } finally {
      applying = false
    }
    editor.pushUndoStop()
    editor.deltaDecorations([], [{
      range: lines(target, target + count - 1),
      options: { isWholeLine: true, className: AGENT_LINE_CLASS, glyphMarginClassName: AGENT_GLYPH_CLASS, hoverMessage: { value: 'Added by the interviewer' } },
    }])
    return { ok: true }
  }

  function highlight(m: AgentMessageOf<'code.highlight'>): AckResult {
    const model = editor.getModel()
    if (!model) return { ok: false, reason: 'editor_not_ready' }
    const content = model.getLinesContent()
    const start = resolveLine(content, { line: m.start_line, expect: m.expect })
    if (start === null) return { ok: false, reason: 'line_changed' }
    const end = Math.min(start + Math.max(0, m.end_line - m.start_line), content.length)
    const ids = editor.deltaDecorations(highlights.get(m.highlight_id) ?? [], [{
      range: lines(start, end),
      options: { isWholeLine: true, className: AGENT_HIGHLIGHT_CLASS, ...(m.note ? { hoverMessage: { value: m.note } } : {}) },
    }])
    highlights.set(m.highlight_id, ids)
    return { ok: true }
  }

  return {
    apply(m: CodeInstruction): AckResult {
      switch (m.type) {
        case 'code.comment':
          return insert(m.at, insertionText(getLanguage(), 'comment', m.text) as string)
        case 'code.insert': {
          const text = insertionText(getLanguage(), 'code', m.text)
          return text === null ? { ok: false, reason: 'too_long' } : insert(m.at, text)
        }
        case 'code.highlight':
          return highlight(m)
        case 'code.clear_highlight': {
          const ids = highlights.get(m.highlight_id)
          if (ids) editor.deltaDecorations(ids, [])
          highlights.delete(m.highlight_id)
          return { ok: true }
        }
      }
    },
    restore(code) {
      setLanguage(code.language)
      editor.getModel()?.setValue(code.text)
    },
    hasContent() {
      const value = editor.getModel()?.getValue() ?? ''
      return value.trim() !== '' && value !== starterText(getLanguage())
    },
    onEdited(ranges) {
      const model = editor.getModel()
      if (!model) return
      for (const [id, ids] of highlights) {
        const r = ids.map((d) => model.getDecorationRange(d)).find((x): x is RangeLike => x !== null)
        if (!r) continue
        if (ranges.some((c) => overlaps(c.startLineNumber, c.endLineNumber, r.startLineNumber, r.endLineNumber))) {
          editor.deltaDecorations(ids, [])
          highlights.delete(id)
        }
      }
    },
    markCandidate(start, end) {
      candidate = editor.deltaDecorations(candidate, [{ range: lines(start, end), options: { isWholeLine: true, className: CANDIDATE_HIGHLIGHT_CLASS } }])
    },
    isApplying: () => applying,
  }
}
