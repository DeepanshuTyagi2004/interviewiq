'use client'
import { useCallback, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils/cn'
import { markSegments, occurrenceAt, type ProblemCard } from '../workspace/panel'
import { useWorkspace } from '../workspace/WorkspaceProvider'
import { formatRuns, runsIn } from './richText'
import { RichText, Runs, sourceOffset } from './RichText'
import { SelectionToolbar } from './SelectionToolbar'
import { clippingAncestor, placeToolbar, type ToolbarPlacement } from './toolbarPlacement'

interface Picked {
  quote: string
  occurrence: number
  top: number
  left: number
  placement: ToolbarPlacement
}

/** The statement with its highlights (interviewer in orange, the candidate's neutral) and the two
 * examples, formatted (code, bold, powers as superscripts; see richText.ts). Selecting statement text offers
 * Highlight · Ask, quoting the source text under the selection. Constraints are never shown here unless
 * the interviewer adds them as a section. */
export function Statement({ card }: { card: ProblemCard }) {
  const { addHighlight, askAbout } = useWorkspace()
  const box = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLParagraphElement>(null)
  const [picked, setPicked] = useState<Picked | null>(null)
  const dismiss = useCallback(() => setPicked(null), [])
  const runs = useMemo(() => formatRuns(card.statement), [card.statement])

  function onMouseUp() {
    const sel = window.getSelection()
    const text = textRef.current
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !text || !box.current) return setPicked(null)
    const range = sel.getRangeAt(0)
    if (!text.contains(range.commonAncestorContainer)) return setPicked(null)
    // The source under the selection, not the formatted text: "10⁵" on screen is "10^5" in the statement.
    const from = sourceOffset(text, range.startContainer, range.startOffset, 'start')
    const to = sourceOffset(text, range.endContainer, range.endOffset, 'end')
    if (from === null || to === null || to <= from) return setPicked(null)
    const raw = card.statement.slice(from, to)
    const quote = raw.trim()
    if (!quote) return setPicked(null)
    const start = from + (raw.length - raw.trimStart().length)
    const r = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null
    const b = box.current.getBoundingClientRect()
    const clip = clippingAncestor(box.current)?.getBoundingClientRect()
    const spot = placeToolbar({
      top: r ? r.top - b.top : 0,
      bottom: r ? r.bottom - b.top : 0,
      center: r ? r.left - b.left + r.width / 2 : 0,
      boxWidth: b.width,
      clipTop: clip ? clip.top - b.top : Number.NEGATIVE_INFINITY,
    })
    setPicked({ quote, occurrence: occurrenceAt(card.statement, quote, start), ...spot })
  }

  function finish(action: () => void) {
    action()
    window.getSelection()?.removeAllRanges()
    setPicked(null)
  }

  return (
    <div ref={box} className="relative">
      <p
        ref={textRef}
        data-testid="statement-text"
        onMouseUp={onMouseUp}
        className="m-0 whitespace-pre-wrap text-[14px] leading-[1.6] text-foreground"
      >
        {withOffsets(markSegments(card.statement, card.highlights)).map(({ piece, start, end }, i) =>
          piece.highlight ? (
            <mark
              key={i}
              data-author={piece.highlight.author}
              title={piece.highlight.note}
              className={cn(
                'rounded-[3px] px-0.5 text-foreground',
                piece.highlight.author === 'interviewer' ? 'bg-brand/15 ring-1 ring-brand/40' : 'bg-panel ring-1 ring-line-4',
              )}
            >
              <Runs runs={runsIn(runs, start, end)} />
            </mark>
          ) : (
            <span key={i}><Runs runs={runsIn(runs, start, end)} /></span>
          ),
        )}
      </p>
      {card.examples.map((ex, i) => (
        <div key={i} className="mt-4">
          <p className="m-0 mb-1.5 text-[12px] font-medium text-ink-3">Example {i + 1}</p>
          <div className="rounded-[11px] border border-line-2 bg-panel/60 px-3 py-2.5 font-mono text-[12.5px] leading-[1.6]">
            <p className="m-0 whitespace-pre-wrap"><span className="text-faint">Input: </span><RichText text={ex.input} /></p>
            <p className="m-0 whitespace-pre-wrap"><span className="text-faint">Output: </span><RichText text={ex.output} /></p>
            {ex.explanation ? (
              <p className="m-0 mt-1 whitespace-pre-wrap font-sans text-[13px] text-muted-foreground"><RichText text={ex.explanation} /></p>
            ) : null}
          </div>
        </div>
      ))}
      {picked ? (
        <SelectionToolbar
          top={picked.top}
          left={picked.left}
          placement={picked.placement}
          onHighlight={() => finish(() => addHighlight(card.itemId, picked.quote, picked.occurrence))}
          onAsk={() => finish(() => askAbout({ surface: 'statement', quote: picked.quote, itemId: card.itemId }))}
          onDismiss={dismiss}
        />
      ) : null}
    </div>
  )
}

/** Each piece with the source span it covers (the pieces cover the statement in order). */
function withOffsets<T extends { text: string }>(pieces: T[]): { piece: T; start: number; end: number }[] {
  let pos = 0
  return pieces.map((piece) => {
    const start = pos
    pos += piece.text.length
    return { piece, start, end: pos }
  })
}
