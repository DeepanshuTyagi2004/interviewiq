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

  it('counts typed characters, and characters that arrived with no key in the same moment as injected', () => {
    const { key, change, integrity, windows } = setup()
    key('keydown')
    change('a')
    vi.advanceTimersByTime(1000)
    change('x'.repeat(45))
    integrity.dispose()
    expect(windows()).toEqual([expect.objectContaining({ keys: 1, chars: 1, charless: 45 })])
  })

  it('does not take a long change made by a key press for injected text (Enter at deep nesting, Alt+Up)', () => {
    const { key, change, integrity, windows } = setup()
    key('keydown')
    change('\n' + ' '.repeat(44))
    integrity.dispose()
    expect(windows()).toEqual([expect.objectContaining({ keys: 1, charless: 0 })])
  })

  it('counts a script inserting one character at a time with no key events, and does not drop that window as quiet', () => {
    const { change, integrity, windows } = setup()
    for (let i = 0; i < 12; i++) change('x')
    integrity.dispose()
    expect(windows()).toEqual([expect.objectContaining({ keys: 0, chars: 0, charless: 12 })])
  })

  it('does not take a native paste or drop in a dev build for injected text', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXT_PUBLIC_ENFORCE_CLIPBOARD', '')
    const { host, change, integrity, windows } = setup()
    host.dispatchEvent(new Event('paste', { bubbles: true, cancelable: true }))
    change('x'.repeat(100))
    integrity.dispose()
    expect(windows()).toHaveLength(0)
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
