'use client'
import { useEffect, useRef } from 'react'
import { Expand, Maximize2, Minimize2, Shrink } from 'lucide-react'
import { EmptyState } from '@/components/ds'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils/cn'
import { useActivity } from '../activity/ActivityProvider'
import { quoteAtPoint, selectedTextIn } from '../activity/panelActivity'
import { addressedCheckOn } from '../addressedCheck'
import { useDirectOnly, useWorkspace } from '../workspace/WorkspaceProvider'
import { Sections } from './Sections'
import { Statement } from './Statement'

export const FLASH_MS = 1200

const iconButton = 'h-7 w-7 text-muted-foreground hover:text-foreground'

/** The problem panel (spec §6.3, §10): one tab per problem the interviewer showed, labelled
 * generically. Expands to fill the right side, has its own full screen, and shrinks to a label strip
 * while the work area is expanded. Stays at one tree position in every mode so nothing remounts. */
export function ProblemPanel() {
  const { panel, selectCard, clearFlash, expanded, setExpanded, panelFull, setPanelFull } = useWorkspace()
  const directOnly = useDirectOnly()
  const { record } = useActivity()
  const active = panel.cards.find((c) => c.itemId === panel.activeId) ?? null
  const strip = expanded === 'work' && !panelFull

  function onPointer(e: React.MouseEvent) {
    const el = (e.target as HTMLElement).closest('p, li')
    if (!el) return
    const quote = quoteAtPoint(document as unknown as Parameters<typeof quoteAtPoint>[0], el, e.clientX, e.clientY)
    if (quote) record({ k: 'ptr', s: 'panel', quote })
  }

  // What the candidate has selected in the problem, sent when it changes (any selection, not only a Highlight), so the
  // interviewer can tell what "this part" or "the highlighted part" is. Cleared selections are reported too.
  const box = useRef<HTMLElement>(null)
  const lastSel = useRef('')
  function onSelect() {
    const text = selectedTextIn(box.current)
    if (text === lastSel.current) return
    lastSel.current = text
    record({ k: 'sel', s: 'panel', text })
  }
  useEffect(() => {
    function onChange() {
      if (!lastSel.current || selectedTextIn(box.current)) return
      lastSel.current = ''
      record({ k: 'sel', s: 'panel', text: '' })
    }
    document.addEventListener('selectionchange', onChange)
    return () => document.removeEventListener('selectionchange', onChange)
  }, [record])

  useEffect(() => {
    if (!panel.flashId) return
    const t = setTimeout(clearFlash, FLASH_MS)
    return () => clearTimeout(t)
  }, [panel.flashId, clearFlash])

  return (
    <section
      ref={box}
      aria-label="Problem"
      onMouseUp={onSelect}
      onKeyUp={onSelect}
      onFocusCapture={() => record({ k: 'focus', s: 'panel' })}
      onMouseMove={onPointer}
      data-testid={panelFull ? 'panel-full' : undefined}
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-card border border-line bg-background shadow-ring',
        panelFull ? 'fixed inset-2 z-[60] shadow-hero' : 'h-full',
      )}
    >
      <header className="flex h-11 flex-none items-center gap-2 border-b border-line px-4">
        <h2 className="m-0 text-[13px] font-medium text-foreground">Problem</h2>
        <div role="tablist" aria-label="Problems" className="flex min-w-0 gap-1 overflow-x-auto">
          {panel.cards.map((c) => (
            <button
              key={c.itemId}
              role="tab"
              type="button"
              aria-selected={c.itemId === panel.activeId}
              onClick={() => {
                selectCard(c.itemId)
                if (strip) setExpanded('none')
              }}
              className={cn(
                'h-[26px] flex-none rounded-full px-3 text-[12.5px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                c.itemId === panel.activeId ? 'bg-ink text-background' : 'text-ink-3 hover:bg-surface-2 hover:text-foreground',
                panel.flashId === c.itemId && 'ring-2 ring-ink/50 motion-safe:animate-pulse',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          {!panelFull ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={expanded === 'panel' ? 'Restore problem panel' : 'Expand problem panel'}
              aria-pressed={expanded === 'panel'}
              onClick={() => setExpanded(expanded === 'panel' ? 'none' : 'panel')}
              className={iconButton}
            >
              {expanded === 'panel' ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={panelFull ? 'Exit problem full screen' : 'Problem full screen'}
            aria-pressed={panelFull}
            onClick={() => setPanelFull(!panelFull)}
            className={iconButton}
          >
            {panelFull ? <Shrink className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </header>
      {strip ? null : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {active ? (
            <>
              {addressedCheckOn() ? (
                <p className="mb-3 text-[12.5px] text-ink-3">
                  {directOnly
                    ? "Listening only for direct questions. Anything else I'll treat as thinking aloud."
                    : "Think aloud freely. I'll only answer when you ask me directly."}
                </p>
              ) : null}
              <Statement card={active} />
              <Sections card={active} />
            </>
          ) : (
            <EmptyState
              title="The interviewer will put the problem here."
              hint="Questions you discuss out loud don't appear here."
              className="py-10"
            />
          )}
        </div>
      )}
    </section>
  )
}
