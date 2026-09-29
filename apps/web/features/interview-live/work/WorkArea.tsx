'use client'

import { useState } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils/cn'
import type { LiveSession } from '../session/types'
import { CodeEditor } from './CodeEditor'
import { DiagramBoard } from './DiagramBoard'

type Surface = 'code' | 'diagram'

/** Left-side work surface: Code Editor / Excalidraw behind a tab toggle, with an optional
 * fullscreen pop-out. Both surfaces stay mounted across tab switches (TabsContent
 * forceMount + `hidden`) so Monaco/Excalidraw state and artifact buffers survive — remounting
 * would lose in-progress work and re-pay the load cost of both editors. */
export function WorkArea({ session }: { session: LiveSession }) {
  const [tab, setTab] = useState<Surface>('code')
  const [popped, setPopped] = useState(false)

  // A single wrapping div hosts the Tabs tree at one stable position, whether inline or
  // popped out — only its classes change. Rendering the surfaces in two different tree
  // locations (inline vs. a separately-mounted popup) would make React unmount/remount
  // CodeEditor/DiagramBoard on every toggle, losing Monaco/Excalidraw state.
  return (
    <div className="relative h-full">
      <div
        data-testid={popped ? 'work-popout' : undefined}
        className={cn(
          'flex flex-col',
          popped ? 'fixed inset-[2.5%] z-[60] rounded-lg border bg-background shadow-2xl' : 'h-full'
        )}
      >
        <Tabs value={tab} onValueChange={(v) => setTab(v as Surface)} className="flex min-h-0 flex-1 flex-col p-2">
          <TabsList className="w-fit shrink-0">
            <TabsTrigger value="code">Code Editor</TabsTrigger>
            <TabsTrigger value="diagram">Excalidraw</TabsTrigger>
          </TabsList>
          <div className="relative mt-2 flex-1">
            <TabsContent
              value="code"
              forceMount
              className={cn('absolute inset-0 m-0 h-full', tab !== 'code' && 'hidden')}
            >
              <CodeEditor session={session} />
            </TabsContent>
            <TabsContent
              value="diagram"
              forceMount
              className={cn('absolute inset-0 m-0 h-full', tab !== 'diagram' && 'hidden')}
            >
              <DiagramBoard session={session} />
            </TabsContent>
          </div>
        </Tabs>
        <div className="shrink-0 border-t p-2">
          {popped ? (
            <Button type="button" variant="outline" size="icon" aria-label="Collapse work area" onClick={() => setPopped(false)}>
              <Minimize2 className="h-4 w-4" />
            </Button>
          ) : (
            <Button type="button" variant="outline" size="icon" aria-label="Expand work area" onClick={() => setPopped(true)}>
              <Maximize2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
