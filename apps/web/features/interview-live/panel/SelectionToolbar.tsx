'use client'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils/cn'
import type { ToolbarPlacement } from './toolbarPlacement'

/** The small floating toolbar over a selection: Highlight · Ask. It keeps the selection alive while
 * clicked (mousedown is prevented) and dismisses on a click elsewhere. */
export function SelectionToolbar({
  top,
  left,
  placement = 'above',
  onHighlight,
  onAsk,
  onDismiss,
}: {
  top: number
  left: number
  /** Above the selection, or below it where the panel would cut an upper toolbar off. */
  placement?: ToolbarPlacement
  onHighlight?: () => void
  onAsk: () => void
  onDismiss: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onDismiss])

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Selection"
      style={{ top, left }}
      onMouseDown={(e) => e.preventDefault()}
      className={cn(
        'absolute z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line-3 bg-card p-1 shadow-hero',
        placement === 'above' ? '-translate-y-[calc(100%+6px)]' : 'translate-y-[6px]',
      )}
    >
      {onHighlight ? (
        <button type="button" onClick={onHighlight} className="h-7 rounded-full px-3 text-[12.5px] text-foreground transition-colors hover:bg-panel">
          Highlight
        </button>
      ) : null}
      <button type="button" onClick={onAsk} className="h-7 rounded-full bg-foreground px-3 text-[12.5px] text-background">
        Ask
      </button>
    </div>
  )
}
