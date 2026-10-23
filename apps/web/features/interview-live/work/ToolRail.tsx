'use client'
import { Code2, PenTool } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useWorkspace, type Surface } from '../workspace/WorkspaceProvider'

const TOOLS: { id: Surface; label: string; name: string; Icon: typeof Code2 }[] = [
  { id: 'code', label: 'Code', name: 'Code editor', Icon: Code2 },
  { id: 'board', label: 'Board', name: 'Whiteboard', Icon: PenTool },
]

/** The tool pills down the right edge (spec §5.5): one icon pill per surface. Both surfaces stay mounted; this only
 * switches which one shows. A dot marks the whiteboard when the interviewer drew there while it was hidden. */
export function ToolRail() {
  const { surface, setSurface, boardAttention } = useWorkspace()
  return (
    <nav aria-label="Tools" className="flex flex-col items-center pr-2 pt-2">
      <div className="flex flex-col gap-1 rounded-full bg-surface p-1 shadow-ring">
        {TOOLS.map(({ id, label, name, Icon }) => (
          <button
            key={id}
            type="button"
            aria-label={name}
            aria-pressed={surface === id}
            title={label}
            onClick={() => setSurface(id)}
            className={cn(
              'relative flex h-10 w-10 items-center justify-center rounded-full text-ink-2 transition-colors duration-150 ease-iq hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              surface === id && 'bg-ink text-background hover:bg-ink hover:text-background',
            )}
          >
            <Icon aria-hidden className="h-4 w-4" />
            {id === 'board' && boardAttention ? (
              <span data-testid="board-attention" className="absolute right-1 top-1 h-2 w-2 rounded-full bg-ink ring-2 ring-surface" />
            ) : null}
          </button>
        ))}
      </div>
    </nav>
  )
}
