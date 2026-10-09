'use client'

import { StatusDot } from '@/components/hud'
import { getLive } from '@/features/interview/api'
import { ActivityPane, ActivityProvider } from '@/features/interview-live/activity/ActivityProvider'
import { BottomBar } from '@/features/interview-live/controls/BottomBar'
import { InterviewerStrip } from '@/features/interview-live/media/InterviewerStrip'
import { useLocalMedia } from '@/features/interview-live/media/useLocalMedia'
import { ProblemPanel } from '@/features/interview-live/panel/ProblemPanel'
import { ProctorBars } from '@/features/interview-live/proctor/ProctorBars'
import { useProctor } from '@/features/interview-live/proctor/useProctor'
import { useInterviewerPresence } from '@/features/interview-live/session/useInterviewerPresence'
import { useLiveSession } from '@/features/interview-live/session/useLiveSession'
import { isMockMode } from '@/features/interview-live/session/mockMode'
import { AskPill } from '@/features/interview-live/work/AskPill'
import { ToolRail } from '@/features/interview-live/work/ToolRail'
import { TranscriptBubbles } from '@/features/interview-live/work/TranscriptBubbles'
import { WorkArea } from '@/features/interview-live/work/WorkArea'
import { WorkspaceProvider } from '@/features/interview-live/workspace/WorkspaceProvider'
import { WorkspaceSplit } from '@/features/interview-live/workspace/WorkspaceSplit'
import { RoomHeader } from './RoomHeader'
import type { RoomMeta } from './roomMeta'

/** The live room (spec §10): the transcript column (20%), the problem panel over the work area (80%),
 * the tool rail, and the centred mic and End controls. Proctoring counts and warns; it never pauses. */
export function LiveView({ sessionId, meta, reconnecting = false }: { sessionId: string; meta?: RoomMeta; reconnecting?: boolean }) {
  const { session, transcript, agentState, requestEnd } = useLiveSession()
  const { stream, micOn, toggleMic } = useLocalMedia(session)
  const proctor = useProctor({ session, enabled: true })
  const name = meta?.interviewer ?? 'Interviewer'
  // GET live re-dispatches the interviewer when the room has none; the local mock has no server to ask.
  const presence = useInterviewerPresence(agentState, sessionId, isMockMode() ? async () => ({}) : getLive)

  return (
    <ActivityProvider session={session}>
      <WorkspaceProvider session={session}>
        <div className="flex h-full min-h-0 w-full flex-col">
          <RoomHeader meta={meta} ledger={proctor.ledger} />
          {reconnecting ? (
            <div role="status" className="flex flex-none items-center gap-3 border-b border-line-2 bg-panel px-4 py-2 text-[13px]">
              <StatusDot state="warn" srLabel="Reconnecting" />
              <span>Connection lost. Reconnecting… what you have written is kept.</span>
            </div>
          ) : null}
          <ProctorBars outOfFullscreen={proctor.outOfFullscreen} shareStopped={proctor.shareStopped} toast={proctor.toast} presence={presence} />
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(260px,20%)_minmax(0,1fr)_56px]">
            <aside aria-label="Interviewer" className="flex min-h-0 min-w-0 flex-col border-r border-line-2">
              <InterviewerStrip name={name} agentState={agentState} stream={stream} micOn={micOn} />
              <AskPill />
              <div className="min-h-0 flex-1 px-3">
                <TranscriptBubbles segments={transcript} interviewerName={name} />
              </div>
            </aside>
            <ActivityPane aria-label="Workspace" className="min-h-0 min-w-0 p-2">
              <WorkspaceSplit panel={<ProblemPanel />} work={<WorkArea session={session} />} />
            </ActivityPane>
            <ToolRail />
          </div>
          <BottomBar micOn={micOn} stream={stream} onToggleMic={toggleMic} onEnd={requestEnd} />
        </div>
      </WorkspaceProvider>
    </ActivityProvider>
  )
}
