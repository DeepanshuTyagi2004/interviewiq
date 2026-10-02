'use client'

import { Maximize, Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface BottomDrawerProps {
  micOn: boolean
  camOn: boolean
  onToggleMic: () => void
  onToggleCam: () => void
  onEnd: () => void
  onToggleFullscreen: () => void
}

const control =
  'h-[38px] gap-2 border-line-3 px-3 text-[13px] aria-pressed:border-faint-2 aria-pressed:bg-panel sm:px-3.5'

/** Bottom control bar for the live interview, in the design's layout: mic, camera and fullscreen
 * on the left, End on the right. `aria-pressed` on the mic/camera buttons reflects whether the
 * control is engaged (muted / hidden) so assistive tech announces the toggle state, not just the
 * icon swap. Each control keeps a visible word from sm up; phones get icons only. */
export function BottomDrawer({
  micOn,
  camOn,
  onToggleMic,
  onToggleCam,
  onEnd,
  onToggleFullscreen,
}: BottomDrawerProps) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-line-2 bg-card px-3 py-3 sm:px-4">
      <Button
        type="button"
        variant="outline"
        aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
        aria-pressed={!micOn}
        onClick={onToggleMic}
        className={control}
      >
        {micOn ? <Mic aria-hidden className="h-4 w-4" /> : <MicOff aria-hidden className="h-4 w-4" />}
        <span className="hidden sm:inline">{micOn ? 'Mute' : 'Unmute'}</span>
      </Button>
      <Button
        type="button"
        variant="outline"
        aria-label={camOn ? 'Turn off camera' : 'Turn on camera'}
        aria-pressed={!camOn}
        onClick={onToggleCam}
        className={control}
      >
        {camOn ? <Video aria-hidden className="h-4 w-4" /> : <VideoOff aria-hidden className="h-4 w-4" />}
        <span className="hidden sm:inline">Camera</span>
      </Button>
      <Button
        type="button"
        variant="outline"
        aria-label="Toggle fullscreen"
        onClick={onToggleFullscreen}
        className={control}
      >
        <Maximize aria-hidden className="h-4 w-4" />
        <span className="hidden md:inline">Fullscreen</span>
      </Button>
      <Button type="button" aria-label="End interview" onClick={onEnd} className="ml-auto h-[38px] gap-2 px-4 text-[13px]">
        <PhoneOff aria-hidden className="h-4 w-4" />
        End interview
      </Button>
    </div>
  )
}
