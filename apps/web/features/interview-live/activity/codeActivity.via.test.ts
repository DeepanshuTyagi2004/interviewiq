import { describe, expect, it, vi } from 'vitest'
import type { ActivityEventBody } from '../protocol/messages'
import { attachCodeActivity, editEvents, type ActivityEditor, type ChangeLike, type ContentEvent } from './codeActivity'

const change: ChangeLike = { range: { startLineNumber: 3, endLineNumber: 3 }, text: 'x', rangeLength: 0 }

describe('edit events carry how they arrived', () => {
  it('adds via when asked and leaves old callers untouched', () => {
    expect(editEvents([change], false, () => 'typed')).toEqual([{ k: 'edit', from_line: 3, to_line: 3, ins: 'x', removed: 0, via: 'typed' }])
    expect(editEvents([change], false)).toEqual([{ k: 'edit', from_line: 3, to_line: 3, ins: 'x', removed: 0 }])
  })

  it('passes the change and the editor event to the classifier when attached', () => {
    const handlers: { content?: (e: ContentEvent) => void } = {}
    const none = () => ({ dispose() {} })
    const editor: ActivityEditor = {
      getModel: () => null,
      getSelection: () => null,
      onDidChangeModelContent: (cb) => { handlers.content = cb; return { dispose() {} } },
      onDidChangeCursorSelection: none,
      onMouseMove: none,
      onDidFocusEditorText: none,
    }
    const seen: ActivityEventBody[] = []
    const classify = vi.fn(() => 'undo' as const)
    attachCodeActivity(editor, (e) => seen.push(e), () => false, classify)
    handlers.content!({ changes: [change], isFlush: false, isUndoing: true })
    expect(classify).toHaveBeenCalledWith(change, expect.objectContaining({ isUndoing: true }))
    expect(seen).toEqual([expect.objectContaining({ k: 'edit', via: 'undo' })])
  })
})
