'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils/cn'
import type { CameraStatus } from '../proctor/camera/monitor'
import { useSpeakingLevel } from './useSpeakingLevel'

interface CameraTileProps {
  stream: MediaStream | null
  micOn?: boolean
  label?: string
  /** The on-device camera check: a quiet, dashed or red border (never colour alone: the status text is read out); none while it starts or can't run. */
  check?: CameraStatus
}

const CHECK_BORDER: Partial<Record<CameraStatus, string>> = {
  ok: 'border-ink/25',
  warn: 'border-dashed border-ink-2',
  violation: 'border-destructive',
}
const CHECK_LABEL: Partial<Record<CameraStatus, string>> = {
  ok: 'Camera check: OK',
  warn: 'Camera check: warning',
  violation: 'Camera check: violation',
}

/** The candidate's camera tile: a muted local video preview that glows with the same
 * ring as AvatarBubble while the candidate is speaking (mic-gated so a silent camera
 * never glows). srcObject isn't a valid JSX attribute, so it's assigned imperatively
 * via a ref effect whenever the stream changes. Shown mirrored, like a selfie view; only this
 * preview is flipped, never the stream the interviewer receives. */
export function CameraTile({ stream, micOn = false, label, check }: CameraTileProps) {
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
        'relative h-full w-full overflow-hidden rounded-2xl bg-inv shadow-ring transition-shadow',
        speaking && 'ring-4 ring-brand/30'
      )}
    >
      <video ref={videoRef} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" />
      {check && CHECK_BORDER[check] ? (
        <span
          data-testid="camera-check"
          data-check={check}
          className={cn('pointer-events-none absolute inset-0 rounded-2xl border-2 transition-colors', CHECK_BORDER[check])}
        >
          <span className="sr-only" role="status">{CHECK_LABEL[check]}</span>
        </span>
      ) : null}
      {label && (
        <span className="absolute bottom-2 left-2 rounded-full bg-inv/70 px-2 py-[2px] text-[11px] font-medium text-white">
          {label}
        </span>
      )}
    </div>
  )
}
