'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils/cn'
import type { AwayEpisode } from './awayEpisode'
import { CAMERA_TEXT, type CameraFlagKind } from './camera/monitor'
import { enterFullscreen } from './keyboardLock'
import { requestEntireScreen } from './screenShare'
import { useAwayCountdown } from './useAwayCountdown'

/** A slim ink banner (spec §5.5): the dot is page-coloured so it reads on ink in both themes; `pulse` marks a running
 * countdown. The label is for screen readers. */
export function ProctorBanner({ label, pulse = false, children }: { label: string; pulse?: boolean; children: React.ReactNode }) {
  return (
    <div role="status" className="flex min-h-9 flex-none items-center gap-3 bg-ink px-4 py-1 text-[13px] text-background [&+&]:border-t [&+&]:border-background/15">
      <span aria-hidden data-motion={pulse ? '' : undefined} className={cn('h-1.5 w-1.5 flex-none rounded-full bg-background', pulse && 'iq-breathe')} />
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}

function Bar({ text, action, onAction }: { text: string; action: string; onAction: () => void }) {
  return (
    <ProctorBanner label="Warning">
      <span className="min-w-0 flex-1">{text}</span>
      <Button
        type="button"
        variant="ghost"
        className="h-7 bg-background px-3 text-[12.5px] text-foreground hover:bg-surface-2 focus-visible:ring-background focus-visible:ring-offset-ink"
        onClick={onAction}
      >
        {action}
      </Button>
    </ProctorBanner>
  )
}

/** The proctoring warnings (spec §7, §10): a toast on each counted event, and a bar for as long as the
 * candidate is out of full screen or not sharing, and a countdown while the candidate is away. The round keeps running. */
export function ProctorBars({
  outOfFullscreen,
  shareStopped,
  toast,
  away = null,
  presence = 'present',
  camera = null,
}: {
  outOfFullscreen: boolean
  shareStopped: boolean
  toast: string | null
  away?: AwayEpisode | null
  presence?: 'present' | 'joining' | 'reconnecting'
  /** A camera-check violation that is still going on: a bar saying what to fix. */
  camera?: CameraFlagKind | null
}) {
  const [shareError, setShareError] = useState<string | null>(null)
  const clock = useAwayCountdown(away)

  async function reshare() {
    const r = await requestEntireScreen()
    if (r.ok) setShareError(null)
    else setShareError(r.reason === 'not_entire_screen' ? 'Share your entire screen, not a window or tab.' : 'Screen sharing was blocked. Allow it and try again.')
  }

  return (
    <>
      {presence !== 'present' ? (
        <ProctorBanner label="Waiting" pulse>
          <span>{presence === 'joining' ? 'Connecting to your interviewer…' : 'Your interviewer is reconnecting…'}</span>
        </ProctorBanner>
      ) : null}
      {toast ? (
        <div role="alert" className="pointer-events-none fixed left-1/2 top-16 z-[70] -translate-x-1/2 rounded-full border border-line bg-background px-4 py-2 text-[13px] font-medium text-foreground shadow-float">
          {toast}
        </div>
      ) : null}
      {clock ? (
        <ProctorBanner label="Warning" pulse>
          <span className="min-w-0 flex-1">
            {clock.phase === 'limit'
              ? `Return to the interview within ${clock.seconds} s. After that it counts as another violation.`
              : `Return now. The interview ends in ${clock.seconds} s.`}
          </span>
        </ProctorBanner>
      ) : null}
      {camera ? (
        <ProctorBanner label="Camera check">
          <span className="min-w-0 flex-1">{CAMERA_TEXT[camera]}</span>
        </ProctorBanner>
      ) : null}
      {outOfFullscreen ? (
        <Bar text="You're out of full screen. Leaving it is counted." action="Return to full screen" onAction={() => void enterFullscreen().catch(() => {})} />
      ) : null}
      {shareStopped ? (
        <Bar text={shareError ?? 'Screen sharing stopped. Share your entire screen again.'} action="Share screen again" onAction={() => void reshare()} />
      ) : null}
    </>
  )
}
