'use client'

import { useState } from 'react'
import { Mic, MicOff, PhoneOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Waveform } from '@/components/visualizations/Waveform'
import { cn } from '@/lib/utils/cn'
import { addressedCheckOn } from '../addressedCheck'
import { useSpeakingLevel } from '../media/useSpeakingLevel'

/** The bottom control (spec §5.5): a floating centred pill with the mic toggle (and its level meter) and End. End
 * asks first; destructive styling lives only in that confirm. */
export function BottomBar({
  micOn,
  stream,
  onToggleMic,
  onEnd,
  onAsk,
}: {
  micOn: boolean
  stream: MediaStream | null
  onToggleMic: () => void
  onEnd: () => void
  onAsk: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const speaking = useSpeakingLevel(stream, micOn)

  return (
    <div className="flex flex-none justify-center px-4 pb-4 pt-2">
      <div className="flex items-center gap-1.5 rounded-full border border-line bg-background p-1.5 shadow-ring">
        <Button
          type="button"
          variant="ghost"
          aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
          aria-pressed={!micOn}
          onClick={onToggleMic}
          className="h-10 gap-2 px-4 text-[13px] aria-pressed:bg-surface-2"
        >
          {micOn ? <Mic aria-hidden className="h-4 w-4" /> : <MicOff aria-hidden className="h-4 w-4" />}
          <Waveform bars={6} height={12} animated={speaking} className={cn('transition-opacity', !speaking && 'opacity-30')} />
          {micOn ? 'Mute' : 'Unmute'}
        </Button>
        {addressedCheckOn() ? (
          <Button type="button" variant="ghost" onClick={onAsk} className="h-10 px-4 text-[13px]">
            Ask interviewer
          </Button>
        ) : null}
        <Button type="button" onClick={() => setConfirming(true)} className="h-10 gap-2 px-5 text-[13px]">
          <PhoneOff aria-hidden className="h-4 w-4" />
          End interview
        </Button>
      </div>
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
