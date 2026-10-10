'use client'

import { StatusDot } from '@/components/hud'
import { getLive } from '@/features/interview/api'
import { ActivityProvider } from '@/features/interview-live/activity/ActivityProvider'
import { BottomBar } from '@/features/interview-live/controls/BottomBar'
import { useLocalMedia } from '@/features/interview-live/media/useLocalMedia'
import { ProctorBars } from '@/features/interview-live/proctor/ProctorBars'
import { useProctor } from '@/features/interview-live/proctor/useProctor'
import { RoomStage } from '@/features/interview-live/room/RoomStage'
import { useInterviewerPresence } from '@/features/interview-live/session/useInterviewerPresence'
import { useLiveSession } from '@/features/interview-live/session/useLiveSession'
import { isMockMode } from '@/features/interview-live/session/mockMode'
import { WorkspaceProvider } from '@/features/interview-live/workspace/WorkspaceProvider'
import { RoomHeader } from './RoomHeader'
import type { RoomMeta } from './roomMeta'

/** The live room (spec §10): the conversation and, beside it, the problem panel over the work area with the tool
 * rail (RoomStage: the conversation has the whole room or about 20% of it, as the interviewer decides), and the
 * centred mic and End controls. Proctoring counts and warns; it never pauses. */
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
          <RoomStage session={session} name={name} agentState={agentState} stream={stream} micOn={micOn} transcript={transcript} />
          <BottomBar micOn={micOn} stream={stream} onToggleMic={toggleMic} onEnd={requestEnd} />
        </div>
      </WorkspaceProvider>
    </ActivityProvider>
  )
}
