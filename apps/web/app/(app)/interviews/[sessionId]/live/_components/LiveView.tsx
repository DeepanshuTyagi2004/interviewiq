'use client'

import { useEffect, useRef } from 'react'
import { MonoPill } from '@/components/patterns'
import { Waveform } from '@/components/visualizations/Waveform'
import { cn } from '@/lib/utils/cn'
import { AvatarBubble } from '@/features/interview-live/media/AvatarBubble'
import { CameraTile } from '@/features/interview-live/media/CameraTile'
import { BottomDrawer } from '@/features/interview-live/controls/BottomDrawer'
import { WorkArea } from '@/features/interview-live/work/WorkArea'
import { TranscriptPanel } from '@/features/interview-live/work/TranscriptPanel'
import { useLocalMedia } from '@/features/interview-live/media/useLocalMedia'
import { useLiveSession } from '@/features/interview-live/session/useLiveSession'
import { useProctor } from '@/features/interview-live/proctor/useProctor'
import { formatElapsed, type RoomMeta } from './roomMeta'

// The interviewer's persona name isn't available client-side — InterviewPlan (which carries it)
// is interviewer-only and never sent to the frontend — so a fixed placeholder stands in for it.
const INTERVIEWER_NAME = 'Interviewer'

/** Time since the candidate entered the room. Writes the DOM directly once a second (no React
 * state), so the clock never re-renders the room. It restarts if the view remounts (reconnect). */
function ElapsedClock() {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const start = Date.now()
    const id = window.setInterval(() => {
      if (ref.current) ref.current.textContent = formatElapsed(Date.now() - start)
    }, 1000)
    return () => window.clearInterval(id)
  }, [])
  return (
    <span
      role="timer"
      aria-label="Time since you joined"
      ref={ref}
      className="rounded-[5px] border border-line-3 px-2 py-[3px] font-mono text-[12.5px] tabular-nums"
    >
      00:00
    </span>
  )
}

// sessionId keeps this component's call signature symmetric with ChecksView/EndedView (both take
// it); LiveView itself doesn't need it — session.connect(sessionId) already ran in ChecksView.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function LiveView({ sessionId, meta }: { sessionId: string; meta?: RoomMeta }) {
  const { session, send, speaking, transcript, ctx } = useLiveSession()
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

  const violations = ctx.violations

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <header className="flex h-12 flex-none items-center gap-3 border-b border-line-2 px-3 text-[13px] sm:gap-4 sm:px-4">
        <span className="min-w-0 truncate">{meta ? `${meta.company} · ${meta.level} · ${meta.round}` : 'Interview room'}</span>
        <span className="ml-auto hidden items-center gap-1.5 text-muted-foreground sm:flex">
          <span
            aria-hidden
            data-motion
            className="h-1.5 w-1.5 animate-[iq-breathe_1.4s_ease-in-out_infinite] rounded-full bg-brand"
          />
          Proctored · full screen
        </span>
        {violations > 0 ? (
          <MonoPill tone="alert" className="ml-auto sm:ml-0">
            {violations === 1 ? '1 pause logged' : `${violations} pauses logged`}
          </MonoPill>
        ) : null}
        <span className={cn(violations > 0 ? '' : 'ml-auto sm:ml-0')}>
          <ElapsedClock />
        </span>
      </header>

      {/* Phone: work area, then transcript, then you (scrolls). iPad: work area across the top,
          transcript and camera below. Desktop: the design's three columns. */}
      <div
        className={cn(
          'grid min-h-0 flex-1 overflow-y-auto',
          "grid-cols-1 grid-rows-[420px_360px_auto] [grid-template-areas:'work'_'talk'_'side']",
          "md:grid-cols-[minmax(0,1fr)_240px] md:grid-rows-[minmax(380px,1.5fr)_minmax(260px,1fr)] md:[grid-template-areas:'work_work'_'talk_side']",
          "lg:grid-cols-[minmax(240px,300px)_minmax(0,1fr)_minmax(200px,248px)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden lg:[grid-template-areas:'talk_work_side']",
        )}
      >
        <aside
          aria-label="Interviewer"
          className="flex min-h-0 min-w-0 flex-col border-t border-line-2 [grid-area:talk] lg:border-r lg:border-t-0"
        >
          <div className="flex flex-none items-center gap-3 px-4 pb-1 pt-4 sm:px-[18px]">
            <div className="h-[38px] w-[38px] flex-none">
              <AvatarBubble name={INTERVIEWER_NAME} speaking={speaking.interviewer} />
            </div>
            <div className="min-w-0">
              <p className="m-0 text-[13.5px]">AI interviewer</p>
              <p className="m-0 flex h-4 items-center text-foreground">
                <Waveform
                  bars={22}
                  height={14}
                  animated={speaking.interviewer}
                  className={cn('transition-opacity', !speaking.interviewer && 'opacity-25')}
                />
                <span className="sr-only">{speaking.interviewer ? 'Speaking' : 'Listening'}</span>
              </p>
            </div>
          </div>
          <div className="min-h-0 flex-1 px-3 pb-3 pt-3 sm:px-[14px]">
            <TranscriptPanel entries={transcript} interviewerName={INTERVIEWER_NAME} />
          </div>
        </aside>

        <section aria-label="Work area" className="min-h-0 min-w-0 [grid-area:work]">
          <WorkArea session={session} />
        </section>

        <aside
          aria-label="You"
          className="flex min-w-0 flex-col gap-5 border-t border-line-2 p-4 [grid-area:side] md:border-l lg:border-t-0"
        >
          <div className="aspect-[4/3] w-full max-w-[360px] md:max-w-none">
            <CameraTile stream={stream} micOn={micOn} label="You" />
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="iq-eyebrow m-0">Live signals</p>
            <p className="m-0 text-[12.5px] leading-[1.5] text-muted-foreground">
              Nothing is scored on screen. Once scoring is live, signals like correctness and
              communication will appear in your debrief.
            </p>
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
