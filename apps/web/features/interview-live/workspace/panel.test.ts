import { describe, expect, it } from 'vitest'
import type { Section } from '../protocol/messages'
import {
  EMPTY_PANEL,
  REPLACED_LABEL,
  cardFromWire,
  findQuote,
  hasCard,
  markSegments,
  occurrenceAt,
  panelReducer,
  type PanelHighlight,
  type PanelState,
} from './panel'

const STATEMENT = 'Return the longest substring with at most two distinct characters. Two distinct is the limit.'
const show = (state: PanelState, itemId = 'slot-1', label = 'Problem 1') =>
  panelReducer(state, { type: 'show', card: { itemId, label, kind: 'problem', statement: STATEMENT, examples: [] } })
const section = (id: string, body = 'n ≤ 10^5'): Section => ({ id, kind: 'constraints', title: 'Constraints', body, author: 'interviewer' })
const hl = (id: string, quote: string, author: PanelHighlight['author'] = 'interviewer'): PanelHighlight => ({ id, quote, occurrence: 0, author })

describe('panelReducer', () => {
  it('shows a problem, makes it active and flashes its tab', () => {
    const s = show(EMPTY_PANEL)
    expect(s.cards).toHaveLength(1)
    expect(s.activeId).toBe('slot-1')
    expect(s.flashId).toBe('slot-1')
    expect(hasCard(s, 'slot-1')).toBe(true)
  })

  it('re-showing the same item updates it without duplicating or losing sections and highlights', () => {
    let s = show(EMPTY_PANEL)
    s = panelReducer(s, { type: 'add_section', itemId: 'slot-1', section: section('c1') })
    s = panelReducer(s, { type: 'highlight', itemId: 'slot-1', highlight: hl('h1', 'two distinct') })
    s = show(show(s, 'slot-2', 'Problem 2'))
    expect(s.cards.map((c) => c.itemId)).toEqual(['slot-1', 'slot-2'])
    expect(s.cards[0].sections).toHaveLength(1)
    expect(s.cards[0].highlights).toHaveLength(1)
    expect(s.activeId).toBe('slot-1')
  })

  it('relabels a replaced problem as "(replaced)" without bringing it back to the front or flashing it, keeping its sections', () => {
    let s = show(EMPTY_PANEL, 'slot-2', 'Problem 2')
    s = panelReducer(s, { type: 'add_section', itemId: 'slot-2', section: section('c1') })
    s = show(s, 'slot-2', 'Problem 2 (replaced)')
    s = show(s, 'reserve-1', 'Problem 2')
    expect(s.cards.map((c) => c.label)).toEqual(['Problem 2 (replaced)', 'Problem 2'])
    expect(s.cards[0].sections).toHaveLength(1)
    expect(s.activeId).toBe('reserve-1')
    expect(s.flashId).toBe('reserve-1')
    const quiet = show(show(EMPTY_PANEL, 'a', 'Problem 1'), 'b', 'Problem 2')
    const relabelled = show(quiet, 'a', 'Problem 1 (replaced)')
    expect(relabelled.activeId).toBe('b')
    expect(relabelled.flashId).toBe('b')
    expect(REPLACED_LABEL.test('Problem 1 (replaced)')).toBe(true)
    expect(REPLACED_LABEL.test('Problem 1')).toBe(false)
  })

  it('ignores a section for an unknown item and replaces a section with the same id', () => {
    let s = panelReducer(show(EMPTY_PANEL), { type: 'add_section', itemId: 'nope', section: section('c1') })
    expect(s.cards[0].sections).toHaveLength(0)
    s = panelReducer(s, { type: 'add_section', itemId: 'slot-1', section: section('c1', 'old') })
    s = panelReducer(s, { type: 'add_section', itemId: 'slot-1', section: section('c1', 'new') })
    expect(s.cards[0].sections.map((x) => x.body)).toEqual(['new'])
  })

  it('clears a highlight by id across cards', () => {
    let s = panelReducer(show(EMPTY_PANEL), { type: 'highlight', itemId: 'slot-1', highlight: hl('h1', 'two distinct') })
    s = panelReducer(s, { type: 'clear_highlight', highlightId: 'h1' })
    expect(s.cards[0].highlights).toEqual([])
  })

  it('selects only known cards, restores, and clears the flash', () => {
    let s = show(EMPTY_PANEL)
    expect(panelReducer(s, { type: 'select', itemId: 'nope' })).toBe(s)
    s = panelReducer(s, { type: 'flash_done' })
    expect(s.flashId).toBeNull()
    const restored = panelReducer(EMPTY_PANEL, { type: 'restore', cards: s.cards, activeId: null })
    expect(restored.activeId).toBe('slot-1')
    expect(restored.flashId).toBeNull()
  })
})

describe('cardFromWire', () => {
  it('maps the wire card to the panel card', () => {
    const card = cardFromWire({
      item_id: 'slot-1', label: 'Problem 1', kind: 'problem', statement: STATEMENT, examples: [], sections: [],
      highlights: [{ highlight_id: 'h1', quote: 'two distinct', occurrence: 1, author: 'candidate' }],
    })
    expect(card.itemId).toBe('slot-1')
    expect(card.highlights[0]).toMatchObject({ id: 'h1', quote: 'two distinct', occurrence: 1, author: 'candidate' })
  })
})

describe('findQuote', () => {
  it('finds the exact text and the nth occurrence', () => {
    expect(findQuote(STATEMENT, 'two distinct')).toEqual({ start: 42, end: 54 })
    expect(findQuote('a b a b', 'a', 1)).toEqual({ start: 4, end: 5 })
  })

  it('matches across re-flowed whitespace', () => {
    const span = findQuote('at most\n  two distinct', 'most two')
    expect(span).not.toBeNull()
    expect('at most\n  two distinct'.slice(span!.start, span!.end)).toBe('most\n  two')
  })

  it('returns null for missing or empty quotes', () => {
    expect(findQuote(STATEMENT, 'three distinct')).toBeNull()
    expect(findQuote(STATEMENT, '   ')).toBeNull()
    expect(findQuote('a b', 'a', 3)).toBeNull()
  })
})

describe('occurrenceAt', () => {
  it('counts earlier copies of the quote', () => {
    expect(occurrenceAt('ab ab ab', 'ab', 0)).toBe(0)
    expect(occurrenceAt('ab ab ab', 'ab', 3)).toBe(1)
    expect(occurrenceAt('ab ab ab', 'ab', 6)).toBe(2)
  })
})

describe('markSegments', () => {
  it('splits text into plain and highlighted pieces; the earlier highlight wins an overlap', () => {
    const pieces = markSegments('one two three', [hl('b', 'two three'), hl('a', 'one two', 'candidate')])
    expect(pieces.map((p) => [p.text, p.highlight?.id ?? null])).toEqual([['one two', 'a'], [' three', null]])
  })

  it('skips highlights whose quote is gone', () => {
    expect(markSegments('abc', [hl('x', 'zzz')])).toEqual([{ text: 'abc' }])
  })
})
