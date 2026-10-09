import { describe, expect, it, vi } from 'vitest'
import type { CodeLanguage } from '../protocol/messages'
import { stampAgent } from '../protocol/messages'
import type { CodeInstruction } from '../workspace/WorkspaceProvider'
import { AGENT_GLYPH_CLASS, AGENT_HIGHLIGHT_CLASS, createCodeApi, type DecorationLike, type EditorLike, type RangeLike } from './codeApi'

class FakeEditor implements EditorLike {
  lines: string[]
  decorations = new Map<string, DecorationLike>()
  undoStops = 0
  private n = 0
  constructor(text: string) { this.lines = text.split('\n') }
  getModel() {
    return {
      getLinesContent: () => this.lines.slice(),
      getValue: () => this.lines.join('\n'),
      setValue: (v: string) => { this.lines = v.split('\n') },
      getDecorationRange: (id: string) => this.decorations.get(id)?.range ?? null,
    }
  }
  executeEdits(_source: string, edits: { range: RangeLike; text: string }[]) {
    for (const e of edits) this.lines.splice(e.range.startLineNumber - 1, 0, ...e.text.replace(/\n$/, '').split('\n'))
    return true
  }
  pushUndoStop() { this.undoStops += 1; return true }
  deltaDecorations(old: string[], next: DecorationLike[]) {
    old.forEach((id) => this.decorations.delete(id))
    return next.map((d) => { const id = `d${++this.n}`; this.decorations.set(id, d); return id })
  }
}

const CODE = 'def f(s):\n    seen = {}\n    for c in s:\n        seen[c] = 1\n    return len(seen)'
const msg = (body: Parameters<typeof stampAgent>[0]) => stampAgent(body) as CodeInstruction
function setup(text = CODE, language: CodeLanguage = 'python') {
  const editor = new FakeEditor(text)
  let lang = language
  const api = createCodeApi(editor, () => lang, (l) => { lang = l })
  return { editor, api, lang: () => lang }
}

describe('createCodeApi', () => {
  it('adds an interviewer comment at the top as its own undo step, marked in the gutter', () => {
    const { editor, api } = setup()
    expect(api.apply(msg({ type: 'code.comment', at: 'top', text: 'Complexity?', purpose: 'question' }))).toEqual({ ok: true })
    expect(editor.lines[0]).toBe('# Complexity?')
    expect(editor.undoStops).toBe(2)
    expect([...editor.decorations.values()][0].options.glyphMarginClassName).toBe(AGENT_GLYPH_CLASS)
  })

  it('uses the language comment syntax above the expected line', () => {
    const { editor, api } = setup('class A {\n  int x;\n}', 'java')
    api.apply(msg({ type: 'code.comment', at: { line: 2, expect: 'int x;' }, text: 'Why int?', purpose: 'question' }))
    expect(editor.lines).toEqual(['class A {', '// Why int?', '  int x;', '}'])
  })

  it('follows a line the candidate pushed down, and refuses one they changed', () => {
    const { editor, api } = setup()
    editor.lines.unshift('# my notes', '# more')
    expect(api.apply(msg({ type: 'code.comment', at: { line: 3, expect: 'for c in s:' }, text: 'Empty s?', purpose: 'question' }))).toEqual({ ok: true })
    expect(editor.lines[4]).toBe('# Empty s?')
    expect(editor.lines[5]).toBe('    for c in s:')
    expect(api.apply(msg({ type: 'code.comment', at: { line: 3, expect: 'while True:' }, text: 'x', purpose: 'question' }))).toEqual({ ok: false, reason: 'line_changed' })
  })

  it('inserts short code verbatim and refuses long inserts', () => {
    const { editor, api } = setup()
    api.apply(msg({ type: 'code.insert', at: 'top', text: 'print(f("ab"))', purpose: 'test_input' }))
    expect(editor.lines[0]).toBe('print(f("ab"))')
    const long = Array.from({ length: 11 }, (_, i) => `x${i} = ${i}`).join('\n')
    expect(api.apply(msg({ type: 'code.insert', at: 'top', text: long, purpose: 'stub' }))).toEqual({ ok: false, reason: 'too_long' })
  })

  it('highlights lines, clears them on request, and drops them when the candidate edits those lines', () => {
    const { editor, api } = setup()
    api.apply(msg({ type: 'code.highlight', highlight_id: 'h1', start_line: 3, end_line: 4, expect: 'for c in s:', note: 'Walk me through this.' }))
    expect([...editor.decorations.values()][0].options.className).toBe(AGENT_HIGHLIGHT_CLASS)
    api.onEdited([{ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }])
    expect(editor.decorations.size).toBe(1)
    api.onEdited([{ startLineNumber: 4, startColumn: 1, endLineNumber: 4, endColumn: 3 }])
    expect(editor.decorations.size).toBe(0)
    api.apply(msg({ type: 'code.highlight', highlight_id: 'h2', start_line: 1, end_line: 1, expect: 'def f(s):' }))
    api.apply(msg({ type: 'code.clear_highlight', highlight_id: 'h2' }))
    expect(editor.decorations.size).toBe(0)
  })

  it('restores code and language, and treats the starter text as empty', () => {
    const { editor, api, lang } = setup('# write your solution here\n')
    expect(api.hasContent()).toBe(false)
    api.restore({ language: 'go', text: 'package main' })
    expect(lang()).toBe('go')
    expect(editor.lines).toEqual(['package main'])
    expect(api.hasContent()).toBe(true)
  })

  it('reports applying only while its own edit runs', () => {
    const { editor, api } = setup()
    const seen: boolean[] = []
    const original = editor.executeEdits.bind(editor)
    editor.executeEdits = vi.fn((s, e) => { seen.push(api.isApplying()); return original(s, e) })
    api.apply(msg({ type: 'code.comment', at: 'top', text: 'x', purpose: 'hint' }))
    expect(seen).toEqual([true])
    expect(api.isApplying()).toBe(false)
  })
})
