'use client'
import { X } from 'lucide-react'
import { useWorkspace } from '../workspace/WorkspaceProvider'

/** "Asking about: …" while an Ask selection waits for the candidate's next question. */
export function AskPill() {
  const { ask, clearAsk } = useWorkspace()
  if (!ask) return null
  return (
    <div role="status" className="mx-3 mt-2 flex items-start gap-2 rounded-2xl bg-surface-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[11.5px] font-medium text-ink-3">Asking about</p>
        <p className="m-0 line-clamp-2 text-[12.5px] text-foreground">“{ask.quote}”</p>
      </div>
      <button
        type="button"
        aria-label="Clear the selection"
        onClick={clearAsk}
        className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <X aria-hidden className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
