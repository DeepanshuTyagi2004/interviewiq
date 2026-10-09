'use client'
import { useEffect } from 'react'
import { Expand, Maximize2, Minimize2, Shrink } from 'lucide-react'
import { HudEmpty } from '@/components/hud'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils/cn'
import { useActivity } from '../activity/ActivityProvider'
import { quoteAtPoint } from '../activity/panelActivity'
import { useWorkspace } from '../workspace/WorkspaceProvider'
import { Sections } from './Sections'
import { Statement } from './Statement'

export const FLASH_MS = 1200

const iconButton = 'h-7 w-7 text-muted-foreground hover:text-foreground'

/** The problem panel (spec §6.3, §10): one tab per problem the interviewer showed, labelled
 * generically. Expands to fill the right side, has its own full screen, and shrinks to a label strip
 * while the work area is expanded. Stays at one tree position in every mode so nothing remounts. */
export function ProblemPanel() {
  const { panel, selectCard, clearFlash, expanded, setExpanded, panelFull, setPanelFull } = useWorkspace()
  const { record } = useActivity()
  const active = panel.cards.find((c) => c.itemId === panel.activeId) ?? null
  const strip = expanded === 'work' && !panelFull

  function onPointer(e: React.MouseEvent) {
    const el = (e.target as HTMLElement).closest('p, li')
    if (!el) return
    const quote = quoteAtPoint(document as unknown as Parameters<typeof quoteAtPoint>[0], el, e.clientX, e.clientY)
    if (quote) record({ k: 'ptr', s: 'panel', quote })
  }

  useEffect(() => {
    if (!panel.flashId) return
    const t = setTimeout(clearFlash, FLASH_MS)
    return () => clearTimeout(t)
  }, [panel.flashId, clearFlash])

  return (
    <section
      aria-label="Problem"
      onFocusCapture={() => record({ k: 'focus', s: 'panel' })}
      onMouseMove={onPointer}
      data-testid={panelFull ? 'panel-full' : undefined}
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-[14px] border border-line-2 bg-card',
        panelFull ? 'fixed inset-2 z-[60] shadow-hero' : 'h-full',
      )}
    >
      <header className="flex h-[38px] flex-none items-center gap-2 border-b border-line-2 px-3">
        <h2 className="m-0 font-mono text-[11px] font-normal uppercase tracking-[0.08em] text-muted-foreground">Problem</h2>
        <span aria-hidden className="h-px w-4 bg-line-3" />
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
                'h-[24px] flex-none rounded-full px-2.5 text-[12px] transition-colors',
                c.itemId === panel.activeId ? 'bg-panel text-foreground' : 'text-faint hover:text-foreground',
                panel.flashId === c.itemId && 'ring-2 ring-brand/50 motion-safe:animate-pulse',
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
              <Statement card={active} />
              <Sections card={active} />
            </>
          ) : (
            <HudEmpty
              tag="Waiting"
              title="The interviewer will put the problem here."
              hint="Questions you discuss out loud don't appear here."
            />
          )}
        </div>
      )}
    </section>
  )
}
