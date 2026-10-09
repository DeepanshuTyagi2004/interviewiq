'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils/cn'
import { useSpeakingLevel } from './useSpeakingLevel'

interface CameraTileProps {
  stream: MediaStream | null
  micOn?: boolean
  label?: string
}

/** The candidate's camera tile: a muted local video preview that glows with the same
 * ring as AvatarBubble while the candidate is speaking (mic-gated so a silent camera
 * never glows). srcObject isn't a valid JSX attribute, so it's assigned imperatively
 * via a ref effect whenever the stream changes. Shown mirrored, like a selfie view; only this
 * preview is flipped, never the stream the interviewer receives. */
export function CameraTile({ stream, micOn = false, label }: CameraTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const speaking = useSpeakingLevel(stream, micOn)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.srcObject = stream
  }, [stream])

  return (
    <div
      data-testid="camera-tile"
      className={cn(
        'relative h-full w-full overflow-hidden rounded-[11px] bg-inv transition-shadow',
        speaking && 'ring-4 ring-brand/30'
      )}
    >
      <video ref={videoRef} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" />
      {label && (
        <span className="absolute bottom-2 left-2 rounded-[6px] bg-inv/75 px-1.5 py-[3px] font-mono text-[10px] uppercase tracking-[0.06em] text-white">
          {label}
        </span>
      )}
    </div>
  )
}
