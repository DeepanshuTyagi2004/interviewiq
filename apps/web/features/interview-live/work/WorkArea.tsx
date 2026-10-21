'use client'

import { Maximize2, Minimize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils/cn'
import { useActivity } from '../activity/ActivityProvider'
import type { LiveSession } from '../session/types'
import { useWorkspace } from '../workspace/WorkspaceProvider'
import { CodeEditor } from './CodeEditor'
import { DiagramBoard } from './DiagramBoard'

/** The work area: the code editor or the whiteboard (chosen in the tool rail). Both stay mounted so
 * Monaco and Excalidraw keep their state; the expand button makes the area fill the right side. */
export function WorkArea({ session }: { session: LiveSession }) {
  const { surface, expanded, setExpanded } = useWorkspace()
  const { record } = useActivity()
  const filled = expanded === 'work'
  const title = surface === 'code' ? 'Code editor' : 'Whiteboard'

  return (
    <section aria-label={title} className="flex h-full min-h-0 flex-col overflow-hidden rounded-card border border-line bg-background shadow-ring">
      <header className="flex h-11 flex-none items-center gap-2 border-b border-line px-4">
        <h2 className="m-0 text-[13px] font-medium text-foreground">{surface === 'code' ? 'Code' : 'Whiteboard'}</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={filled ? 'Restore work area' : 'Expand work area'}
          aria-pressed={filled}
          onClick={() => setExpanded(filled ? 'none' : 'work')}
          className="ml-auto h-7 w-7 text-muted-foreground hover:text-foreground"
        >
          {filled ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </Button>
      </header>
      <div className="relative min-h-0 flex-1">
        <div className={cn('absolute inset-0', surface !== 'code' && 'hidden')} onFocusCapture={() => record({ k: 'focus', s: 'code' })}>
          <CodeEditor session={session} />
        </div>
        <div className={cn('absolute inset-0', surface !== 'board' && 'hidden')} onFocusCapture={() => record({ k: 'focus', s: 'board' })}>
          <DiagramBoard session={session} />
        </div>
      </div>
    </section>
  )
}
