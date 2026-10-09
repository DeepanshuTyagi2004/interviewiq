'use client'

import { useState } from 'react'
import { Mic, MicOff, PhoneOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Waveform } from '@/components/visualizations/Waveform'
import { cn } from '@/lib/utils/cn'
import { useSpeakingLevel } from '../media/useSpeakingLevel'

/** The bottom row (spec §10): the mic toggle with a level meter and End, centred. End asks first. */
export function BottomBar({
  micOn,
  stream,
  onToggleMic,
  onEnd,
}: {
  micOn: boolean
  stream: MediaStream | null
  onToggleMic: () => void
  onEnd: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const speaking = useSpeakingLevel(stream, micOn)

  return (
    <div className="flex flex-none items-center justify-center gap-3 border-t border-line-2 bg-card px-4 py-3">
      <Button
        type="button"
        variant="outline"
        aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
        aria-pressed={!micOn}
        onClick={onToggleMic}
        className="h-10 gap-2 rounded-full border-line-3 px-4 text-[13px] aria-pressed:border-faint-2 aria-pressed:bg-panel"
      >
        {micOn ? <Mic aria-hidden className="h-4 w-4" /> : <MicOff aria-hidden className="h-4 w-4" />}
        <Waveform bars={6} height={12} animated={speaking} className={cn('transition-opacity', !speaking && 'opacity-30')} />
        {micOn ? 'Mute' : 'Unmute'}
      </Button>
      <Button type="button" onClick={() => setConfirming(true)} className="h-10 gap-2 rounded-full px-5 text-[13px]">
        <PhoneOff aria-hidden className="h-4 w-4" />
        End interview
      </Button>
      <ConfirmationDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="End the interview?"
        description="The round ends for good, and you can't rejoin it."
        confirmLabel="End interview"
        destructive
        onConfirm={onEnd}
      />
    </div>
  )
}
