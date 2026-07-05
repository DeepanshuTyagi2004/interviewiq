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
  const { session, send, speaking, transcript } = useLiveSession()
  const { stream, micOn, camOn, toggleMic, toggleCam } = useLocalMedia(session)
  // LiveView is only mounted while the machine is in `live` or `paused`, so proctoring is always
  // enabled here; ViolationOverlay (rendered above this by LiveInterview when paused) is what
  // surfaces the resulting pause to the candidate.
  useProctor({ session, enabled: true, onViolation: () => {} })

  function handleEnd() {
    // Dispatch END then ENDED (with no reason) BEFORE disconnecting, so the machine records
    // ctx.endedReason as 'completed' (via the ENDED handler's `event.reason ?? ctx.endedReason ??
    // 'completed'` fallback) while still in `ending`. Only then call disconnect() — its resulting
    // connectionState flip to 'disconnected' fires the provider's onConnectionChange bridge, which
    // dispatches ENDED{reason:'aborted_technical'}, but by then the machine is already in `ended`
    // (which has no ENDED handler), so that dispatch is a harmless no-op. Reversing this order (as
    // it used to be — disconnect() before the trailing ENDED) let the bridge's 'aborted_technical'
    // win the race, mislabeling every normal manual end.
    send({ type: 'END' })
    send({ type: 'ENDED' })
    void session.disconnect()
    // Don't leave the ended/report screen stuck in fullscreen.
    if (document.fullscreenElement) void document.exitFullscreen()
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
          <ul
            aria-label="Interviewer captions"
            className="max-h-40 shrink-0 space-y-1 overflow-y-auto rounded border border-neutral-700 p-2 text-sm"
          >
            {transcript.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
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
