/**
 * Problem-panel state (spec §6.3): one card per problem the interviewer has shown, with the sections
 * and highlights either side added. Pure, so the provider can check an instruction before applying it.
 */
import type { Author, Example, Section, WireCard } from '../protocol/messages'

export interface PanelHighlight {
  id: string
  quote: string
  occurrence: number
  note?: string
  author: Author
}

export interface ProblemCard {
  itemId: string
  /** Generic, from the agent: "Problem 1". Never the problem's name. */
  label: string
  kind: 'problem' | 'question'
  statement: string
  examples: Example[]
  sections: Section[]
  highlights: PanelHighlight[]
}

export interface PanelState {
  cards: ProblemCard[]
  activeId: string | null
  /** The card whose tab flashes because the interviewer just showed it. */
  flashId: string | null
}

export type PanelAction =
  | { type: 'show'; card: Pick<ProblemCard, 'itemId' | 'label' | 'kind' | 'statement' | 'examples'> }
  | { type: 'add_section'; itemId: string; section: Section }
  | { type: 'highlight'; itemId: string; highlight: PanelHighlight }
  | { type: 'clear_highlight'; highlightId: string }
  | { type: 'select'; itemId: string }
  | { type: 'restore'; cards: ProblemCard[]; activeId: string | null }
  | { type: 'flash_done' }

export const EMPTY_PANEL: PanelState = { cards: [], activeId: null, flashId: null }

export function hasCard(state: PanelState, itemId: string): boolean {
  return state.cards.some((c) => c.itemId === itemId)
}

function mapCard(state: PanelState, itemId: string, fn: (c: ProblemCard) => ProblemCard): PanelState {
  if (!hasCard(state, itemId)) return state
  return { ...state, cards: state.cards.map((c) => (c.itemId === itemId ? fn(c) : c)) }
}

export function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case 'show': {
      const { card } = action
      const cards = hasCard(state, card.itemId)
        ? state.cards.map((c) => (c.itemId === card.itemId ? { ...c, ...card } : c))
        : [...state.cards, { ...card, sections: [], highlights: [] }]
      return { cards, activeId: card.itemId, flashId: card.itemId }
    }
    case 'add_section':
      return mapCard(state, action.itemId, (c) => ({
        ...c,
        sections: [...c.sections.filter((s) => s.id !== action.section.id), action.section],
      }))
    case 'highlight':
      return mapCard(state, action.itemId, (c) => ({
        ...c,
        highlights: [...c.highlights.filter((h) => h.id !== action.highlight.id), action.highlight],
      }))
    case 'clear_highlight':
      return {
        ...state,
        cards: state.cards.map((c) => ({ ...c, highlights: c.highlights.filter((h) => h.id !== action.highlightId) })),
      }
    case 'select':
      return hasCard(state, action.itemId) ? { ...state, activeId: action.itemId } : state
    case 'restore':
      return { cards: action.cards, activeId: action.activeId ?? action.cards.at(-1)?.itemId ?? null, flashId: null }
    case 'flash_done':
      return state.flashId ? { ...state, flashId: null } : state
  }
}

export function cardFromWire(c: WireCard): ProblemCard {
  return {
    itemId: c.item_id,
    label: c.label,
    kind: c.kind,
    statement: c.statement,
    examples: c.examples,
    sections: c.sections,
    highlights: c.highlights.map((h) => ({ id: h.highlight_id, quote: h.quote, occurrence: h.occurrence, note: h.note, author: h.author })),
  }
}

export interface Span {
  start: number
  end: number
}

/** Collapses whitespace runs to one space, remembering where each kept character came from. */
function collapse(s: string): { text: string; map: number[] } {
  let text = ''
  const map: number[] = []
  let inSpace = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (/\s/.test(ch)) {
      if (inSpace) continue
      inSpace = true
      text += ' '
    } else {
      inSpace = false
      text += ch
    }
    map.push(i)
  }
  return { text, map }
}

function nth(haystack: string, needle: string, occurrence: number): number {
  let from = 0
  for (let n = 0; ; n++) {
    const i = haystack.indexOf(needle, from)
    if (i === -1 || n === occurrence) return i
    from = i + 1
  }
}

/** Where the `occurrence`-th (0-based) copy of `quote` sits in `text`: an exact match first, then one
 * that ignores re-flowed whitespace (an LLM often changes line breaks). Null when it isn't there. */
export function findQuote(text: string, quote: string, occurrence = 0): Span | null {
  const q = quote.trim()
  if (!q) return null
  const exact = nth(text, q, occurrence)
  if (exact !== -1) return { start: exact, end: exact + q.length }
  const t = collapse(text)
  const cq = collapse(q).text
  const i = nth(t.text, cq, occurrence)
  if (i === -1) return null
  return { start: t.map[i], end: t.map[i + cq.length - 1] + 1 }
}

/** Which occurrence of `quote` starts at offset `start`, for anchoring the candidate's selection. */
export function occurrenceAt(text: string, quote: string, start: number): number {
  let n = 0
  let i = text.indexOf(quote)
  while (i !== -1 && i < start) {
    n += 1
    i = text.indexOf(quote, i + 1)
  }
  return n
}

export interface TextPiece {
  text: string
  highlight?: PanelHighlight
}

/** Splits `text` into plain and highlighted pieces. On overlap the earlier-starting highlight wins. */
export function markSegments(text: string, highlights: PanelHighlight[]): TextPiece[] {
  const spans = highlights
    .map((h) => ({ h, span: findQuote(text, h.quote, h.occurrence) }))
    .filter((x): x is { h: PanelHighlight; span: Span } => x.span !== null)
    .sort((a, b) => a.span.start - b.span.start)
  const out: TextPiece[] = []
  let pos = 0
  for (const { h, span } of spans) {
    if (span.start < pos) continue
    if (span.start > pos) out.push({ text: text.slice(pos, span.start) })
    out.push({ text: text.slice(span.start, span.end), highlight: h })
    pos = span.end
  }
  if (pos < text.length) out.push({ text: text.slice(pos) })
  return out
}
