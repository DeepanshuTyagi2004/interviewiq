'use client'
import { useRef, useState } from 'react'
import { cn } from '@/lib/utils/cn'
import { useWorkspace } from './WorkspaceProvider'

export const MIN_FRACTION = 0.12
export const MAX_FRACTION = 0.8
export const DEFAULT_FRACTION = 0.2
const STEP = 0.05

const clamp = (n: number) => Math.min(MAX_FRACTION, Math.max(MIN_FRACTION, n))

/** The right side's vertical split (spec §10): the problem panel on top (20% to start, drag or arrow
 * keys to resize) and the work area below. Either can fill the side; both stay mounted. */
export function WorkspaceSplit({ panel, work }: { panel: React.ReactNode; work: React.ReactNode }) {
  const { expanded } = useWorkspace()
  const [fraction, setFraction] = useState(DEFAULT_FRACTION)
  const box = useRef<HTMLDivElement>(null)

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId) || !box.current) return
    const r = box.current.getBoundingClientRect()
    if (r.height > 0) setFraction(clamp((e.clientY - r.top) / r.height))
  }

  const panelStyle: React.CSSProperties =
    expanded === 'panel' ? { flex: '1 1 0%' } : expanded === 'work' ? { flex: '0 0 auto' } : { flex: `0 0 ${fraction * 100}%` }

  return (
    <div ref={box} className="flex h-full min-h-0 flex-col">
      <div style={panelStyle} className="min-h-0">{panel}</div>
      {expanded === 'none' ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize problem panel"
          aria-valuenow={Math.round(fraction * 100)}
          aria-valuemin={MIN_FRACTION * 100}
          aria-valuemax={MAX_FRACTION * 100}
          tabIndex={0}
          onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
          onPointerMove={onPointerMove}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setFraction((f) => clamp(f + STEP))
            if (e.key === 'ArrowUp') setFraction((f) => clamp(f - STEP))
          }}
          className="group flex h-2 flex-none cursor-row-resize items-center justify-center focus-visible:outline-none"
        >
          <span aria-hidden className="h-[3px] w-10 rounded-full bg-line-3 transition-colors group-hover:bg-faint-2 group-focus-visible:bg-ring" />
        </div>
      ) : (
        <div aria-hidden className="h-2 flex-none" />
      )}
      <div className={cn('min-h-0 flex-1', expanded === 'panel' && 'hidden')}>{work}</div>
    </div>
  )
}
