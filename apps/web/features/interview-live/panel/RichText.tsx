'use client'
import { useMemo, type ReactNode } from 'react'
import { formatRuns, isMapped, type Run } from './richText'

/** Shows formatted runs (see richText.ts); each element carries the source offsets it stands for. */
export function Runs({ runs }: { runs: Run[] }) {
  const out: ReactNode[] = []
  for (let i = 0; i < runs.length; ) {
    const wrap = runs[i].wrap
    if (!wrap) {
      out.push(<RunText key={runs[i].start} run={runs[i]} />)
      i += 1
      continue
    }
    const group: Run[] = []
    while (i < runs.length && runs[i].wrap?.id === wrap.id) group.push(runs[i++])
    const inner = group.map((r) => <RunText key={r.start} run={r} />)
    out.push(
      wrap.kind === 'code' ? (
        <code key={`c${group[0].start}`} className="rounded-[4px] bg-panel px-1 py-px font-mono text-[0.9em] ring-1 ring-line-2">{inner}</code>
      ) : (
        <strong key={`b${group[0].start}`} className="font-semibold">{inner}</strong>
      ),
    )
  }
  return <>{out}</>
}

function RunText({ run }: { run: Run }) {
  const props = { 'data-src': run.start, 'data-src-end': run.end, 'data-mapped': isMapped(run) ? '' : undefined }
  if (!run.sup) return <span {...props}>{run.text}</span>
  // A hidden caret keeps the page text "10^5" (not "105") for screen readers and for what the room reads off the panel.
  return (
    <>
      <span className="sr-only" data-src={run.start} data-src-end={run.start}>^</span>
      <sup {...props} className="ml-px text-[0.7em]">{run.text}</sup>
    </>
  )
}

/** Formatted text with no highlights: a constraint, a hint or a note. */
export function RichText({ text }: { text: string }) {
  const runs = useMemo(() => formatRuns(text), [text])
  return <Runs runs={runs} />
}

function textNodes(root: Node): Text[] {
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const out: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text)
  return out
}

/** The source offset a selection boundary inside `root` stands for, or null when it is not on formatted text.
 * In a symbol (≤ for <=) the boundary snaps to the symbol's start or end. */
export function sourceOffset(root: HTMLElement, node: Node, offset: number, edge: 'start' | 'end'): number | null {
  if (node.nodeType !== Node.TEXT_NODE) {
    // A boundary between elements: the first text after it (a start) or the last text before it (an end).
    const at = root.ownerDocument.createRange()
    at.setStart(node, offset)
    const texts = textNodes(root)
    const pick = edge === 'start'
      ? texts.find((t) => at.comparePoint(t, 0) >= 0)
      : [...texts].reverse().find((t) => at.comparePoint(t, t.length) <= 0)
    if (!pick) return null
    return sourceOffset(root, pick, edge === 'start' ? 0 : pick.length, edge)
  }
  const el = node.parentElement?.closest<HTMLElement>('[data-src]')
  if (!el || !root.contains(el)) return null
  const start = Number(el.dataset.src)
  const end = Number(el.dataset.srcEnd)
  if (el.dataset.mapped !== undefined) return start + Math.min(offset, end - start)
  return offset > 0 ? end : start
}
