import { describe, expect, it } from 'vitest'
import type { ActivityEventBody } from '../protocol/messages'
import { attachCodeActivity, caretEvent, codePointer, createStarterSwapGuard, editEvents, type ActivityEditor, type SelectionLike } from './codeActivity'

const sel = (over: Partial<SelectionLike> = {}): SelectionLike => ({
  isEmpty: () => true, startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 1, positionLineNumber: 3, positionColumn: 7, ...over,
})

describe('editEvents', () => {
  const change = { range: { startLineNumber: 4, endLineNumber: 5 }, text: 'x'.repeat(250), rangeLength: 12 }
  it('reports where, what was typed (capped) and how much was replaced', () => {
    expect(editEvents([change], false)).toEqual([{ k: 'edit', from_line: 4, to_line: 5, ins: 'x'.repeat(200), removed: 12 }])
  })
  it('ignores a whole-model replacement (a restore or a language switch)', () => {
    expect(editEvents([change], true)).toEqual([])
  })
})

describe('emoji at a length cap', () => {
  it('is never cut in half: a half emoji would make the worker drop the whole batch', () => {
    const lone = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/
    const change = { range: { startLineNumber: 1, endLineNumber: 1 }, text: `${'a'.repeat(199)}😀😀`, rangeLength: 0 }
    const [ev] = editEvents([change], false)
    expect(ev.k === 'edit' && ev.ins).toBe(`${'a'.repeat(199)}😀`)
    const pointer = codePointer({ lineNumber: 1, column: 1 }, () => `${'b'.repeat(79)}😀😀`)
    expect(pointer && pointer.k === 'ptr' && pointer.s === 'code' && lone.test(pointer.text)).toBe(false)
    const picked = sel({ isEmpty: () => false })
    const caret = caretEvent(picked, () => `${'c'.repeat(119)}😀😀`)
    expect(caret.k === 'caret' && lone.test(caret.text ?? '')).toBe(false)
  })
})

describe('codePointer and caretEvent', () => {
  it('names the line under the pointer, trimmed and capped', () => {
    expect(codePointer({ lineNumber: 2, column: 5 }, () => `   ${'y'.repeat(100)}   `)).toEqual({ k: 'ptr', s: 'code', line: 2, col: 5, text: 'y'.repeat(80) })
  })
  it('says nothing when the pointer is over no text', () => {
    expect(codePointer(null, () => '')).toBeNull()
  })
  it('reports a bare caret, and a selection with its lines and text', () => {
    expect(caretEvent(sel(), () => '')).toEqual({ k: 'caret', line: 3, col: 7 })
    const picked = sel({ isEmpty: () => false, startLineNumber: 3, endLineNumber: 5 })
    expect(caretEvent(picked, () => 'z'.repeat(300))).toEqual({ k: 'caret', line: 3, col: 7, sel: [3, 5], text: 'z'.repeat(120) })
  })
})

function fakeEditor() {
  const handlers: Record<string, (e: never) => void> = {}
  const disposed: string[] = []
  const on = (name: string) => (cb: (e: never) => void) => {
    handlers[name] = cb
    return { dispose: () => { disposed.push(name) } }
  }
  const editor: ActivityEditor = {
    getModel: () => ({ getLineContent: (n) => `line ${n} text`, getValueInRange: () => 'picked' }),
    getSelection: () => sel(),
    onDidChangeModelContent: on('content') as ActivityEditor['onDidChangeModelContent'],
    onDidChangeCursorSelection: on('cursor') as ActivityEditor['onDidChangeCursorSelection'],
    onMouseMove: on('mouse') as ActivityEditor['onMouseMove'],
    onDidFocusEditorText: on('focus') as ActivityEditor['onDidFocusEditorText'],
  }
  return { editor, handlers, disposed }
}

describe('attachCodeActivity', () => {
  it('records typing, caret moves, pointer targets and focus as the candidate does them', () => {
    const { editor, handlers } = fakeEditor()
    const got: ActivityEventBody[] = []
    attachCodeActivity(editor, (e) => got.push(e), () => false)
    handlers.content({ isFlush: false, changes: [{ range: { startLineNumber: 1, endLineNumber: 1 }, text: 'a', rangeLength: 0 }] } as never)
    handlers.cursor(undefined as never)
    handlers.mouse({ target: { position: { lineNumber: 2, column: 3 } } } as never)
    handlers.focus(undefined as never)
    expect(got.map((e) => e.k)).toEqual(['edit', 'caret', 'ptr', 'focus'])
  })

  it('records nothing for the interviewer’s own edits and the cursor moves they cause', () => {
    const { editor, handlers } = fakeEditor()
    const got: ActivityEventBody[] = []
    attachCodeActivity(editor, (e) => got.push(e), () => true)
    handlers.content({ isFlush: false, changes: [{ range: { startLineNumber: 1, endLineNumber: 1 }, text: '# why?\n', rangeLength: 0 }] } as never)
    handlers.cursor(undefined as never)
    expect(got).toEqual([])
  })

  it('stops listening when disposed', () => {
    const { editor, disposed } = fakeEditor()
    attachCodeActivity(editor, () => {}, () => false)()
    expect(disposed.sort()).toEqual(['content', 'cursor', 'focus', 'mouse'])
  })
})

describe('createStarterSwapGuard', () => {
  it('treats the editor swapping its starter text (a language switch on untouched code) as not typing', () => {
    const guard = createStarterSwapGuard()
    guard.expect('// write your solution here\n')
    expect(guard.matches('// write your solution here\n')).toBe(true)      // the swap's own change
    expect(guard.matches('// write your solution here\n')).toBe(true)      // and the cursor move after it
  })
  it('stops as soon as the candidate writes something, and is spent after that', () => {
    const guard = createStarterSwapGuard()
    guard.expect('// starter\n')
    expect(guard.matches('// starter\nx')).toBe(false)
    expect(guard.matches('// starter\n')).toBe(false)
  })
  it('does nothing when no swap was announced', () => {
    expect(createStarterSwapGuard().matches('anything')).toBe(false)
  })
})
