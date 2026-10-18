/**
 * What text the pointer rests on in the problem panel (spec §5.1): the sentence around the pointer, capped.
 * `caretPositionFromPoint` (standard) or `caretRangeFromPoint` (older Chromium and Safari) finds the text position.
 */
import { capCodePoints } from './text'

const BREAKS = ['. ', '? ', '! ', '\n']

export function quoteFromText(text: string, offset: number, max = 120): string {
  const at = Math.min(Math.max(offset, 0), text.length)
  const start = Math.max(0, ...BREAKS.map((b) => { const i = text.lastIndexOf(b, at - 1); return i === -1 ? -1 : i + b.length }))
  const ends = BREAKS.map((b) => text.indexOf(b, at)).filter((i) => i !== -1)
  const end = ends.length ? Math.min(...ends) + 1 : text.length
  let sentence = text.slice(start, end).trim()
  if (sentence.length > max) {
    const rel = at - start
    const from = Math.max(0, Math.min(rel - Math.floor(max / 2), sentence.length - max))
    sentence = sentence.slice(from, from + max).trim()
  }
  return capCodePoints(sentence, max) // the window above counts UTF-16 units and can start or end inside an emoji
}

export interface CaretDoc {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  caretRangeFromPoint?: (x: number, y: number) => { startContainer: Node; startOffset: number } | null
}

/** The sentence under (x, y) inside `root`, or null if the point is not on text in `root`. */
export function quoteAtPoint(doc: CaretDoc, root: Element, x: number, y: number): string | null {
  const pos = doc.caretPositionFromPoint?.(x, y)
  const range = pos ? null : doc.caretRangeFromPoint?.(x, y)
  const node = pos?.offsetNode ?? range?.startContainer
  const offset = pos?.offset ?? range?.startOffset ?? 0
  if (!node || node.nodeType !== Node.TEXT_NODE || !root.contains(node)) return null
  const before = document.createRange()
  before.selectNodeContents(root)
  before.setEnd(node, offset)
  const quote = quoteFromText(root.textContent ?? '', before.toString().length)
  return quote || null
}

export const MAX_SELECTED_PANEL = 300

/** The text the candidate has selected inside `root` (the problem panel), whitespace collapsed and capped; '' when nothing is
 * selected there. Any selection counts, not only one turned into a highlight, so "this part" can be resolved to it. */
export function selectedTextIn(root: Element | null, sel: Selection | null = typeof window === 'undefined' ? null : window.getSelection()): string {
  if (!root || !sel || sel.isCollapsed || sel.rangeCount === 0) return ''
  if (!root.contains(sel.getRangeAt(0).commonAncestorContainer)) return ''
  return capCodePoints(sel.toString().replace(/\s+/g, ' ').trim(), MAX_SELECTED_PANEL)
}
