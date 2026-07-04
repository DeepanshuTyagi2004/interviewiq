'use client'

import { AvatarBubble } from '@/features/interview-live/media/AvatarBubble'
import { CameraTile } from '@/features/interview-live/media/CameraTile'
import { BottomDrawer } from '@/features/interview-live/controls/BottomDrawer'
import { WorkArea } from '@/features/interview-live/work/WorkArea'
import { useLocalMedia } from '@/features/interview-live/media/useLocalMedia'
import { useLiveSession } from '@/features/interview-live/session/useLiveSession'
import { useProctor } from '@/features/interview-live/proctor/useProctor'

// The interviewer's persona name isn't available client-side — InterviewPlan (which carries it)
// is interviewer-only and never sent to the frontend — so a fixed placeholder stands in for it.
const INTERVIEWER_NAME = 'Interviewer'

// sessionId keeps this component's call signature symmetric with ChecksView/EndedView (both take
// it); LiveView itself doesn't need it — session.connect(sessionId) already ran in ChecksView.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function LiveView({ sessionId }: { sessionId: string }) {
  const { session, send, speaking } = useLiveSession()
  const { stream, micOn, camOn, toggleMic, toggleCam } = useLocalMedia(session)
  // LiveView is only mounted while the machine is in `live` or `paused`, so proctoring is always
  // enabled here; ViolationOverlay (rendered above this by LiveInterview when paused) is what
  // surfaces the resulting pause to the candidate.
  useProctor({ session, enabled: true, onViolation: () => {} })

  async function handleEnd() {
    send({ type: 'END' })
    await session.disconnect()
    send({ type: 'ENDED' })
  }

  function handleToggleFullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void document.documentElement.requestFullscreen()
    }
  }

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex min-h-0 flex-1">
        <div className="h-full w-4/5 p-2">
          <WorkArea session={session} />
        </div>
        <aside className="flex h-full w-1/5 flex-col gap-2 p-2">
          <div className="min-h-0 flex-1">
            <CameraTile stream={stream} micOn={micOn} label="You" />
          </div>
          <div className="min-h-0 flex-1">
            <AvatarBubble name={INTERVIEWER_NAME} speaking={speaking.interviewer} />
          </div>
        </aside>
      </div>
      <BottomDrawer
        micOn={micOn}
        camOn={camOn}
        onToggleMic={toggleMic}
        onToggleCam={toggleCam}
        onEnd={() => void handleEnd()}
        onToggleFullscreen={handleToggleFullscreen}
      />
    </div>
  )
}
