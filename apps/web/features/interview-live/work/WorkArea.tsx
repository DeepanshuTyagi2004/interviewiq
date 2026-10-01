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

const tabClass =
  'h-[26px] rounded-[5px] px-2.5 text-[12.5px] font-normal text-faint shadow-none hover:text-foreground data-[state=active]:bg-panel data-[state=active]:text-foreground data-[state=active]:shadow-none'

/** The work surface: Code editor / Whiteboard (Excalidraw) behind the design's small tab bar, with
 * an optional fullscreen pop-out. Both surfaces stay mounted across tab switches (TabsContent
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
          'flex flex-col bg-card',
          popped ? 'fixed inset-[2.5%] z-[60] overflow-hidden rounded-[12px] border border-line-3 shadow-hero' : 'h-full'
        )}
      >
        <Tabs value={tab} onValueChange={(v) => setTab(v as Surface)} className="flex min-h-0 flex-1 flex-col">
          <div className="flex h-[38px] shrink-0 items-center gap-1 border-b border-line-2 px-2.5">
            <TabsList className="h-auto gap-1 bg-transparent p-0">
              <TabsTrigger value="code" className={tabClass}>
                Code editor
              </TabsTrigger>
              <TabsTrigger value="diagram" className={tabClass}>
                Whiteboard
              </TabsTrigger>
            </TabsList>
            {popped ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Collapse work area"
                onClick={() => setPopped(false)}
                className="ml-auto h-7 w-7 text-muted-foreground hover:text-foreground"
              >
                <Minimize2 className="h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Expand work area"
                onClick={() => setPopped(true)}
                className="ml-auto h-7 w-7 text-muted-foreground hover:text-foreground"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <div className="relative min-h-0 flex-1">
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
      </div>
    </div>
  )
}
