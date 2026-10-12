'use client'
import { useState } from 'react'
import { StatusDot } from '@/components/hud'
import { Button } from '@/components/ui/button'
import type { AwayEpisode } from './awayEpisode'
import { enterFullscreen } from './keyboardLock'
import { requestEntireScreen } from './screenShare'
import { useAwayCountdown } from './useAwayCountdown'

function Bar({ text, action, onAction }: { text: string; action: string; onAction: () => void }) {
  return (
    <div role="status" className="flex flex-none items-center gap-3 border-b border-line-2 bg-panel px-4 py-2 text-[13px]">
      <StatusDot state="warn" srLabel="Warning" />
      <span className="min-w-0 flex-1">{text}</span>
      <Button type="button" variant="outline" className="h-8 rounded-full border-line-3 px-3 text-[12.5px]" onClick={onAction}>
        {action}
      </Button>
    </div>
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
}: {
  outOfFullscreen: boolean
  shareStopped: boolean
  toast: string | null
  away?: AwayEpisode | null
  presence?: 'present' | 'joining' | 'reconnecting'
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
        <div role="status" className="flex flex-none items-center gap-3 border-b border-line-2 bg-panel px-4 py-2 text-[13px]">
          <StatusDot state="live" srLabel="Waiting" />
          <span>{presence === 'joining' ? 'Connecting to your interviewer…' : 'Your interviewer is reconnecting…'}</span>
        </div>
      ) : null}
      {toast ? (
        <div role="alert" className="pointer-events-none fixed left-1/2 top-16 z-[70] -translate-x-1/2 rounded-full border border-line-3 bg-card px-4 py-2 text-[13px] shadow-hero">
          {toast}
        </div>
      ) : null}
      {clock ? (
        <div role="status" className="flex flex-none items-center gap-3 border-b border-line-2 bg-panel px-4 py-2 text-[13px]">
          <StatusDot state="warn" srLabel="Warning" />
          <span className="min-w-0 flex-1">
            {clock.phase === 'limit'
              ? `Return to the interview within ${clock.seconds} s. After that it counts as another violation.`
              : `Return now. The interview ends in ${clock.seconds} s.`}
          </span>
        </div>
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
