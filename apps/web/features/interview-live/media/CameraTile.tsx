'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils/cn'
import type { CameraStatus } from '../proctor/camera/monitor'
import { useSpeakingLevel } from './useSpeakingLevel'

interface CameraTileProps {
  stream: MediaStream | null
  micOn?: boolean
  label?: string
  /** The on-device camera check: a green, amber or red border; none while it starts or can't run. */
  check?: CameraStatus
}

const CHECK_BORDER: Partial<Record<CameraStatus, string>> = {
  ok: 'border-[hsl(var(--color-lc-easy))]',
  warn: 'border-[hsl(var(--color-lc-medium))]',
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
        'relative h-full w-full overflow-hidden rounded-[11px] bg-inv transition-shadow',
        speaking && 'ring-4 ring-brand/30'
      )}
    >
      <video ref={videoRef} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" />
      {check && CHECK_BORDER[check] ? (
        <span
          data-testid="camera-check"
          data-check={check}
          className={cn('pointer-events-none absolute inset-0 rounded-[11px] border-[3px] transition-colors', CHECK_BORDER[check])}
        >
          <span className="sr-only" role="status">{CHECK_LABEL[check]}</span>
        </span>
      ) : null}
      {label && (
        <span className="absolute bottom-2 left-2 rounded-[6px] bg-inv/75 px-1.5 py-[3px] font-mono text-[10px] uppercase tracking-[0.06em] text-white">
          {label}
        </span>
      )}
    </div>
  )
}
