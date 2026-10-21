'use client'
import { useEffect } from 'react'
import { Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils/cn'
import { startVisionDownload, useVisionAssets, type VisionState } from './visionAssets'

const NOT_CHECKED = "You can still start; if it isn't ready when you join, your camera won't be checked this round."

function copy(s: VisionState, pct: number): { title: string; hint: string } {
  switch (s.phase) {
    case 'ready':
      return { title: 'Camera check ready', hint: 'It runs on your device. Nothing is recorded or sent.' }
    case 'downloading':
      return { title: `Camera check downloading · ${pct}%`, hint: NOT_CHECKED }
    case 'paused':
      return { title: `Camera check paused · ${pct}%`, hint: 'It continues after your interview.' }
    case 'error':
      return { title: 'Camera check couldn’t download', hint: NOT_CHECKED }
    case 'unsupported':
      return { title: 'Camera check not available in this browser', hint: "You can still take the interview; your camera won't be checked." }
    default:
      return { title: 'Camera check not downloaded yet', hint: NOT_CHECKED }
  }
}

/** Whether the camera check's files are on this device (tick) or not (cross), with the background download's
 * progress. Mounting it also makes sure the download is running. */
export function CameraCheckStatus() {
  const s = useVisionAssets()
  useEffect(() => { startVisionDownload() }, [])
  if (s.phase === 'checking') return null
  const ready = s.phase === 'ready'
  const pct = Math.min(100, Math.floor((s.received / s.total) * 100))
  const { title, hint } = copy(s, pct)
  const showBar = s.phase === 'downloading' || s.phase === 'paused'

  return (
    <div data-testid="camera-check-status" data-phase={s.phase} className="flex items-start gap-3 rounded-tile border border-line px-4 py-3">
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full text-white',
          ready ? 'bg-[hsl(var(--color-lc-easy))]' : 'bg-destructive',
        )}
      >
        {ready ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <X className="h-3.5 w-3.5" strokeWidth={3} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 text-[13.5px]">
          <span className="sr-only">{ready ? 'Ready: ' : 'Not ready: '}</span>
          {title}
        </p>
        {showBar ? (
          <div
            role="progressbar"
            aria-label="Camera check download"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            className="mt-2 h-1 overflow-hidden rounded-full bg-line-2"
          >
            <div className="h-full rounded-full bg-brand transition-[width] duration-300" style={{ width: `${pct}%` }} />
          </div>
        ) : null}
        <p className="m-0 mt-1 text-[12.5px] leading-[1.45] text-muted-foreground">{hint}</p>
      </div>
      {s.phase === 'error' ? (
        <Button type="button" variant="outline" className="h-7 rounded-full px-3 text-[12px]" onClick={() => startVisionDownload()}>
          Retry
        </Button>
      ) : null}
    </div>
  )
}
