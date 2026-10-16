'use client'

import { useEffect, useMemo, useRef } from 'react'
import { StatusDot } from '@/components/hud'
import { getLive } from '@/features/interview/api'
import { ActivityProvider } from '@/features/interview-live/activity/ActivityProvider'
import { BottomBar } from '@/features/interview-live/controls/BottomBar'
import { useLocalMedia } from '@/features/interview-live/media/useLocalMedia'
import { useCameraProctor } from '@/features/interview-live/proctor/camera/useCameraProctor'
import { attachRoomCopyGuard, attachRoomFieldGuard } from '@/features/interview-live/proctor/editorClipboard'
import { clipboardRulesActive, forgetBuffer } from '@/features/interview-live/proctor/localClipboard'
import { ProctorActionsProvider } from '@/features/interview-live/proctor/ProctorContext'
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
  // On-device only (no frames leave the browser, no LLM): the tile's border and the camera ledger, nothing more.
  const camera = useCameraProctor({ stream, enabled: true })
  const proctorActions = useMemo(() => ({ foreignPaste: proctor.foreignPaste }), [proctor.foreignPaste])
  // Copy and cut anywhere in the room stay in the room (the editor guards its own); only while the clipboard rules are on.
  const foreignRef = useRef(proctor.foreignPaste)
  useEffect(() => { foreignRef.current = proctor.foreignPaste }, [proctor.foreignPaste])
  useEffect(() => {
    if (!clipboardRulesActive()) return
    const detach = attachRoomCopyGuard(document)
    // Text fields in the room (a note on a problem) obey the same paste, drop, copy and cut rules as the editor.
    const detachFields = attachRoomFieldGuard(document, { onForeign: (info) => foreignRef.current(info) })
    return () => {
      detach()
      detachFields()
      forgetBuffer()
    }
  }, [])
  const name = meta?.interviewer ?? 'Interviewer'
  // GET live re-dispatches the interviewer when the room has none; the local mock has no server to ask.
  const presence = useInterviewerPresence(agentState, sessionId, isMockMode() ? async () => ({}) : getLive)

  return (
    <ProctorActionsProvider value={proctorActions}>
      <ActivityProvider session={session}>
        <WorkspaceProvider session={session}>
          <div className="flex h-full min-h-0 w-full flex-col">
            <RoomHeader meta={meta} ledger={proctor.ledger} cameraFlags={camera.flags.length} />
            {reconnecting ? (
              <div role="status" className="flex flex-none items-center gap-3 border-b border-line-2 bg-panel px-4 py-2 text-[13px]">
                <StatusDot state="warn" srLabel="Reconnecting" />
                <span>Connection lost. Reconnecting… what you have written is kept.</span>
              </div>
            ) : null}
            <ProctorBars outOfFullscreen={proctor.outOfFullscreen} shareStopped={proctor.shareStopped} toast={proctor.toast} away={proctor.away} presence={presence} camera={camera.status === 'violation' ? camera.reason : null} />
            <RoomStage session={session} name={name} agentState={agentState} stream={stream} micOn={micOn} transcript={transcript} cameraCheck={camera.status} />
            <BottomBar micOn={micOn} stream={stream} onToggleMic={toggleMic} onEnd={requestEnd} />
          </div>
        </WorkspaceProvider>
      </ActivityProvider>
    </ProctorActionsProvider>
  )
}
