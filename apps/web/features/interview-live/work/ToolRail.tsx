'use client'
import { Code2, PenTool } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useWorkspace, type Surface } from '../workspace/WorkspaceProvider'

const TOOLS: { id: Surface; label: string; name: string; Icon: typeof Code2 }[] = [
  { id: 'code', label: 'Code', name: 'Code editor', Icon: Code2 },
  { id: 'board', label: 'Board', name: 'Whiteboard', Icon: PenTool },
]

/** The tool buttons down the right edge (spec §10). Both surfaces stay mounted; this only switches
 * which one shows. A dot marks the whiteboard when the interviewer drew there while it was hidden. */
export function ToolRail() {
  const { surface, setSurface, boardAttention } = useWorkspace()
  return (
    <nav aria-label="Tools" className="flex flex-col items-center gap-1.5 border-l border-line-2 py-2">
      {TOOLS.map(({ id, label, name, Icon }) => (
        <button
          key={id}
          type="button"
          aria-label={name}
          aria-pressed={surface === id}
          onClick={() => setSurface(id)}
          className={cn(
            'relative flex h-12 w-11 flex-col items-center justify-center gap-0.5 rounded-[11px] text-muted-foreground transition-colors hover:text-foreground',
            surface === id && 'bg-panel text-foreground',
          )}
        >
          <Icon aria-hidden className="h-4 w-4" />
          <span aria-hidden className="font-mono text-[9px] uppercase tracking-[0.08em]">{label}</span>
          {id === 'board' && boardAttention ? (
            <span data-testid="board-attention" className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-brand" />
          ) : null}
        </button>
      ))}
    </nav>
  )
}
