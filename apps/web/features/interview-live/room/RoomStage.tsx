'use client'
import { cn } from '@/lib/utils/cn'
import { ActivityPane } from '../activity/ActivityProvider'
import { InterviewerStrip } from '../media/InterviewerStrip'
import { ProblemPanel } from '../panel/ProblemPanel'
import type { TranscriptSegment } from '../session/transcript'
import type { AgentState, LiveSession } from '../session/types'
import { AskPill } from '../work/AskPill'
import { ToolRail } from '../work/ToolRail'
import { TranscriptBubbles } from '../work/TranscriptBubbles'
import { WorkArea } from '../work/WorkArea'
import { useRoomState } from '../workspace/WorkspaceProvider'
import { WorkspaceSplit } from '../workspace/WorkspaceSplit'

/** A calm line shown while the interviewer is slow to answer. The live region stays in the page, so a screen
 * reader announces the text when it appears. */
function SlowNotice({ slow, talk }: { slow: boolean; talk: boolean }) {
  return (
    <div role="status" aria-live="polite" className={cn('flex-none', talk ? 'px-4' : 'px-3')}>
      {slow ? (
        <p className="m-0 flex items-center gap-2 py-2 text-[12.5px] text-muted-foreground">
          <span aria-hidden data-motion className="h-1.5 w-1.5 flex-none animate-pulse rounded-full bg-faint-2" />
          Your interviewer is taking a moment…
        </p>
      ) : null}
    </div>
  )
}

/**
 * The room between the header and the bottom bar (spec §10). It has two columns: the conversation, and the work
 * side (problem panel, code editor / whiteboard, tool rail).
 *
 * - `talk` (greeting, small talk, resume questions, the closing): the conversation fills the room as a centred
 *   column, and the work side is shut to zero width.
 * - `work`: the conversation is the narrow left column (about 20%), the work side the rest.
 *
 * The change is one CSS transition on the grid columns (`1fr 0fr` <-> `1fr 4fr`; browsers animate fr values).
 * The work side is never unmounted, only squeezed to zero width and hidden, so the editor, the whiteboard, the
 * problem panel and the activity capture keep their state across `talk` -> `work` -> `talk`.
 */
export function RoomStage({
  session, name, agentState, stream, micOn, transcript,
}: { session: LiveSession; name: string; agentState: AgentState; stream: MediaStream | null; micOn: boolean; transcript: TranscriptSegment[] }) {
  const { layout, slow } = useRoomState()
  const talk = layout === 'talk'

  return (
    <div
      data-testid="room-stage"
      data-layout={layout}
      className={cn(
        'grid min-h-0 flex-1 transition-[grid-template-columns] duration-500 ease-out motion-reduce:transition-none',
        talk ? 'grid-cols-[1fr_0fr]' : 'grid-cols-[1fr_4fr]',
      )}
    >
      {/* min-w-[260px] keeps the narrow column readable on small screens, as it always was. */}
      <aside aria-label="Interviewer" className={cn('flex min-h-0 min-w-[260px] flex-col', !talk && 'border-r border-line-2')}>
        {/* Wide rooms: a centred column of comfortable reading width. In the narrow column it is simply full width. */}
        <div className="mx-auto flex min-h-0 w-full max-w-[760px] flex-1 flex-col">
          <InterviewerStrip name={name} agentState={agentState} stream={stream} micOn={micOn} layout={layout} />
          <AskPill />
          <div className={cn('min-h-0 flex-1 transition-[padding] duration-500 ease-out motion-reduce:transition-none', talk ? 'px-4' : 'px-3')}>
            <TranscriptBubbles segments={transcript} interviewerName={name} comfortable={talk} />
          </div>
          <SlowNotice slow={slow} talk={talk} />
        </div>
      </aside>
      {/* Shut in `talk`: zero width and clipped; `inert` and aria-hidden take it out of the tab order and away from
          screen readers; `invisible` applies only after the transition (browsers hold `visibility` until it ends). */}
      <div
        data-testid="work-pane"
        inert={talk}
        aria-hidden={talk || undefined}
        className={cn(
          'grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)_56px] overflow-hidden transition-[visibility] duration-500 motion-reduce:transition-none',
          talk && 'invisible',
        )}
      >
        <ActivityPane aria-label="Workspace" className="min-h-0 min-w-0 p-2">
          <WorkspaceSplit panel={<ProblemPanel />} work={<WorkArea session={session} />} />
        </ActivityPane>
        <ToolRail />
      </div>
    </div>
  )
}
