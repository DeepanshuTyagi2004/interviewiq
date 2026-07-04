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

/** Bottom control bar for the live interview: end call, mic/camera toggles, and a fullscreen
 * toggle. `aria-pressed` on the mic/camera buttons reflects whether the control is engaged
 * (muted / hidden) so assistive tech announces the toggle state, not just the icon swap. */
export function BottomDrawer({
  micOn,
  camOn,
  onToggleMic,
  onToggleCam,
  onEnd,
  onToggleFullscreen,
}: BottomDrawerProps) {
  return (
    <div className="flex shrink-0 items-center justify-center gap-3 border-t bg-background p-3">
      <Button type="button" variant="destructive" size="icon" aria-label="End interview" onClick={onEnd}>
        <PhoneOff className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
        aria-pressed={!micOn}
        onClick={onToggleMic}
      >
        {micOn ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={camOn ? 'Turn off camera' : 'Turn on camera'}
        aria-pressed={!camOn}
        onClick={onToggleCam}
      >
        {camOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Toggle fullscreen"
        onClick={onToggleFullscreen}
      >
        <Maximize className="h-4 w-4" />
      </Button>
    </div>
  )
}
