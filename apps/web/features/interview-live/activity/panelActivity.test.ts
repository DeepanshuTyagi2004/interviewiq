import { describe, expect, it } from 'vitest'
import { quoteAtPoint, quoteFromText, selectedTextIn } from './panelActivity'

const TEXT = 'Given a string s, return the length of the longest substring. There is exactly one answer! Is it unique?'

describe('quoteFromText', () => {
  it('returns the sentence around the offset', () => {
    expect(quoteFromText(TEXT, TEXT.indexOf('longest'))).toBe('Given a string s, return the length of the longest substring.')
    expect(quoteFromText(TEXT, TEXT.indexOf('exactly'))).toBe('There is exactly one answer!')
    expect(quoteFromText(TEXT, TEXT.indexOf('unique'))).toBe('Is it unique?')
  })
  it('caps a long sentence to a window around the offset', () => {
    const long = `${'word '.repeat(80)}target ${'word '.repeat(80)}`
    const q = quoteFromText(long, long.indexOf('target'), 120)
    expect(q.length).toBeLessThanOrEqual(120)
    expect(q).toContain('target')
  })
  it('is safe on empty text and out-of-range offsets', () => {
    expect(quoteFromText('', 0)).toBe('')
    expect(quoteFromText('abc', 99)).toBe('abc')
  })
})

describe('quoteAtPoint', () => {
  function setup() {
    const root = document.createElement('p')
    root.textContent = TEXT
    document.body.appendChild(root)
    return { root, text: root.firstChild as Text }
  }
  it('resolves the point through caretPositionFromPoint, relative to the whole paragraph', () => {
    const { root, text } = setup()
    const doc = { caretPositionFromPoint: () => ({ offsetNode: text, offset: TEXT.indexOf('exactly') }) }
    expect(quoteAtPoint(doc, root, 1, 1)).toBe('There is exactly one answer!')
  })
  it('falls back to caretRangeFromPoint', () => {
    const { root, text } = setup()
    const doc = { caretRangeFromPoint: () => ({ startContainer: text, startOffset: TEXT.indexOf('unique') }) }
    expect(quoteAtPoint(doc, root, 1, 1)).toBe('Is it unique?')
  })
  it('is null when the point is not in this text, or the browser cannot tell', () => {
    const { root } = setup()
    const other = document.createTextNode('elsewhere')
    expect(quoteAtPoint({ caretPositionFromPoint: () => ({ offsetNode: other, offset: 2 }) }, root, 1, 1)).toBeNull()
    expect(quoteAtPoint({}, root, 1, 1)).toBeNull()
  })
})

describe('selectedTextIn', () => {
  function select(node: Node, start: number, end: number) {
    const range = document.createRange()
    range.setStart(node, start)
    range.setEnd(node, end)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
  }

  it('returns the text selected inside the panel, whitespace collapsed', () => {
    document.body.innerHTML = '<section id="panel"><p>Find the  pair. Return the indices.</p></section><p id="out">Elsewhere</p>'
    const text = document.querySelector('#panel p')!.firstChild!
    select(text, 0, 15)
    expect(selectedTextIn(document.getElementById('panel'))).toBe('Find the pair.')
  })

  it('is empty when nothing is selected or the selection is outside the panel', () => {
    document.body.innerHTML = '<section id="panel"><p>Find the pair.</p></section><p id="out">Elsewhere</p>'
    window.getSelection()!.removeAllRanges()
    expect(selectedTextIn(document.getElementById('panel'))).toBe('')
    select(document.getElementById('out')!.firstChild!, 0, 4)
    expect(selectedTextIn(document.getElementById('panel'))).toBe('')
  })
})
