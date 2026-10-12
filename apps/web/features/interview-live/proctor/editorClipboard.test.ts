import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachEditorClipboard, attachRoomCopyGuard, selectedText, type ClipRange, type ClipSelection, type ClipboardEditor } from './editorClipboard'
import { CLIPBOARD_MARKER, bufferIsWholeLine, getBuffer, resetClipboard } from './localClipboard'

const sel = (sl: number, sc: number, el: number, ec: number): ClipSelection => ({
  startLineNumber: sl, startColumn: sc, endLineNumber: el, endColumn: ec, isEmpty: () => sl === el && sc === ec,
})

function fakeEditor(lines: string[], selections: ClipSelection[]) {
  const valueInRange = (r: ClipRange): string => {
    if (r.startLineNumber === r.endLineNumber) return lines[r.startLineNumber - 1].slice(r.startColumn - 1, r.endColumn - 1)
    const parts = [lines[r.startLineNumber - 1].slice(r.startColumn - 1)]
    for (let n = r.startLineNumber + 1; n < r.endLineNumber; n++) parts.push(lines[n - 1])
    parts.push(lines[r.endLineNumber - 1].slice(0, r.endColumn - 1))
    return parts.join('\n')
  }
  const editor: ClipboardEditor = {
    getSelections: () => selections,
    getModel: () => ({ getValueInRange: valueInRange, getLineMaxColumn: (n: number) => lines[n - 1].length + 1, getLineCount: () => lines.length }),
    executeEdits: vi.fn(() => true),
    pushUndoStop: vi.fn(() => true),
    trigger: vi.fn(),
  }
  return editor
}

function clipEvent(type: 'copy' | 'cut' | 'paste', osText = '') {
  const written: Record<string, string> = {}
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => osText, setData: (t: string, v: string) => { written[t] = v } } })
  return { event, written }
}

function dragEvent(type: 'dragover' | 'drop', text = '') {
  const event = new Event(type, { bubbles: true, cancelable: true })
  const dataTransfer = { getData: () => text, dropEffect: 'copy' }
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  return { event, dataTransfer }
}

function setup(lines: string[], selections: ClipSelection[]) {
  const host = document.createElement('div')
  const inner = document.createElement('textarea')
  host.appendChild(inner)
  document.body.appendChild(host)
  const editor = fakeEditor(lines, selections)
  const deps = { asLocalPaste: vi.fn((fn: () => void) => fn()), onForeign: vi.fn() }
  const dispose = attachEditorClipboard(host, editor, deps)
  return { host, inner, editor, deps, dispose }
}

const CODE = ['def f(x):', '    return x']

afterEach(() => {
  resetClipboard()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('selectedText', () => {
  it('takes the whole line, with its line break, for an empty selection', () => {
    expect(selectedText(fakeEditor(['a = 1', 'b = 2'], [sel(1, 3, 1, 3)]))).toMatchObject({ text: 'a = 1\n', wholeLine: true })
  })

  it('takes the last line without a line break', () => {
    expect(selectedText(fakeEditor(['a = 1', 'b = 2'], [sel(2, 1, 2, 1)]))).toMatchObject({ text: 'b = 2', wholeLine: true })
  })

  it('joins several selections with a line break', () => {
    expect(selectedText(fakeEditor(CODE, [sel(1, 1, 1, 4), sel(2, 5, 2, 11)]))).toMatchObject({ text: 'def\nreturn', wholeLine: false })
  })
})

describe('attachEditorClipboard', () => {
  it('copy keeps the selection in the room, leaves only the marker, and hides the event from the editor', () => {
    const { inner } = setup(CODE, [sel(2, 5, 2, 13)])
    const seen = vi.fn()
    inner.addEventListener('copy', seen)
    const { event, written } = clipEvent('copy')
    inner.dispatchEvent(event)
    expect(getBuffer()).toBe('return x')
    expect(written['text/plain']).toBe(CLIPBOARD_MARKER)
    expect(event.defaultPrevented).toBe(true)
    expect(seen).not.toHaveBeenCalled()
  })

  it('copy with no selection takes the line and pastes it on a line of its own', () => {
    const { inner, editor } = setup(CODE, [sel(1, 4, 1, 4)])
    inner.dispatchEvent(clipEvent('copy').event)
    expect(getBuffer()).toBe('def f(x):\n')
    expect(bufferIsWholeLine()).toBe(true)
    inner.dispatchEvent(clipEvent('paste', CLIPBOARD_MARKER).event)
    expect(editor.trigger).toHaveBeenCalledWith('room-clipboard', 'paste', expect.objectContaining({ text: 'def f(x):\n', pasteOnNewLine: true }))
  })

  it('cut keeps the selection in the room and removes it from the code', () => {
    const { inner, editor } = setup(CODE, [sel(2, 5, 2, 13)])
    const { event } = clipEvent('cut')
    inner.dispatchEvent(event)
    expect(getBuffer()).toBe('return x')
    expect(editor.executeEdits).toHaveBeenCalledWith('room-cut', [{ range: expect.objectContaining({ startLineNumber: 2, startColumn: 5, endColumn: 13 }), text: '' }])
    expect(event.defaultPrevented).toBe(true)
  })

  it('pastes the room buffer when the OS clipboard holds the marker, tagged as a local paste', () => {
    const { inner, editor, deps } = setup(CODE, [sel(2, 5, 2, 13)])
    inner.dispatchEvent(clipEvent('copy').event)
    const { event } = clipEvent('paste', CLIPBOARD_MARKER)
    inner.dispatchEvent(event)
    expect(deps.asLocalPaste).toHaveBeenCalledTimes(1)
    expect(editor.trigger).toHaveBeenCalledWith('room-clipboard', 'paste', expect.objectContaining({ text: 'return x', pasteOnNewLine: false }))
    expect(deps.onForeign).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })

  it('does nothing when the marker is on the clipboard but the buffer is gone (a refresh)', () => {
    const { inner, editor, deps } = setup(CODE, [sel(1, 1, 1, 1)])
    const { event } = clipEvent('paste', CLIPBOARD_MARKER)
    inner.dispatchEvent(event)
    expect(editor.trigger).not.toHaveBeenCalled()
    expect(deps.onForeign).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })

  it('blocks a foreign paste, reports its size but never its text, and inserts nothing', () => {
    const { inner, editor, deps } = setup(CODE, [sel(1, 1, 1, 1)])
    const text = 'def solve(): pass\n    return 1'
    const { event } = clipEvent('paste', text)
    inner.dispatchEvent(event)
    expect(editor.trigger).not.toHaveBeenCalled()
    expect(editor.executeEdits).not.toHaveBeenCalled()
    expect(deps.onForeign).toHaveBeenCalledWith({ source: 'paste', chars: text.length, lines: 2 })
    expect(event.defaultPrevented).toBe(true)
  })

  it('ignores an empty or blank paste', () => {
    const { inner, deps } = setup(CODE, [sel(1, 1, 1, 1)])
    inner.dispatchEvent(clipEvent('paste', '').event)
    inner.dispatchEvent(clipEvent('paste', '  \n ').event)
    expect(deps.onForeign).not.toHaveBeenCalled()
  })

  it('treats dropped text as foreign and refuses the drop', () => {
    const { inner, deps } = setup(CODE, [sel(1, 1, 1, 1)])
    const seen = vi.fn()
    inner.addEventListener('dragover', seen)
    const over = dragEvent('dragover')
    inner.dispatchEvent(over.event)
    expect(over.event.defaultPrevented).toBe(true)
    expect(seen).not.toHaveBeenCalled()
    const drop = dragEvent('drop', 'answer = 42')
    inner.dispatchEvent(drop.event)
    expect(drop.event.defaultPrevented).toBe(true)
    expect(deps.onForeign).toHaveBeenCalledWith({ source: 'drop', chars: 11, lines: 1 })
  })

  it('ignores a drop that carries no text (a file)', () => {
    const { inner, deps } = setup(CODE, [sel(1, 1, 1, 1)])
    inner.dispatchEvent(dragEvent('drop', '').event)
    expect(deps.onForeign).not.toHaveBeenCalled()
  })

  it('stops handling events once disposed', () => {
    const { inner, dispose, deps } = setup(CODE, [sel(1, 1, 1, 1)])
    dispose()
    const { event } = clipEvent('paste', 'def solve(): pass')
    inner.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(deps.onForeign).not.toHaveBeenCalled()
  })
})

describe('attachRoomCopyGuard', () => {
  function copyFrom(el: Element) {
    const { event, written } = clipEvent('copy')
    el.dispatchEvent(event)
    return { event, written }
  }

  it('keeps a copy from the problem panel in the room', () => {
    vi.spyOn(document, 'getSelection').mockReturnValue({ toString: () => 'two sum' } as unknown as Selection)
    const dispose = attachRoomCopyGuard(document)
    const p = document.body.appendChild(document.createElement('p'))
    const { event, written } = copyFrom(p)
    expect(getBuffer()).toBe('two sum')
    expect(written['text/plain']).toBe(CLIPBOARD_MARKER)
    expect(event.defaultPrevented).toBe(true)
    dispose()
  })

  it('leaves the editor, text fields and the whiteboard to their own handling', () => {
    vi.spyOn(document, 'getSelection').mockReturnValue({ toString: () => 'selected' } as unknown as Selection)
    const dispose = attachRoomCopyGuard(document)
    for (const html of ['<div class="monaco-editor"><textarea></textarea></div>', '<input />', '<div class="excalidraw"><canvas></canvas></div>']) {
      const wrap = document.body.appendChild(document.createElement('div'))
      wrap.innerHTML = html
      const { event } = copyFrom(wrap.firstElementChild!.firstElementChild ?? wrap.firstElementChild!)
      expect(event.defaultPrevented).toBe(false)
    }
    expect(getBuffer()).toBe('')
    dispose()
  })
})
