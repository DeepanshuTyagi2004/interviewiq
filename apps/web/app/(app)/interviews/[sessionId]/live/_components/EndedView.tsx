'use client'

import Link from 'next/link'
import { ArrowRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { EndReason } from '@/features/interview-live/protocol/messages'
import { useLiveSession } from '@/features/interview-live/session/useLiveSession'
import { RoomCentered } from './RoomFrame'
import { roomEyebrow, type RoomMeta } from './roomMeta'

const COPY: Record<EndReason, { title: string; body: (message: string | null) => string; note: string | null; debrief: boolean }> = {
  completed: {
    title: 'Interview complete',
    body: (m) => m ?? 'Thanks for taking the round.',
    note: 'Your debrief will appear here once scoring is live.',
    debrief: true,
  },
  ended_by_interviewer: {
    title: 'The interviewer ended the interview',
    body: (m) => m ?? 'The round was ended early.',
    note: 'This counts as an attempt.',
    debrief: true,
  },
  candidate_ended: {
    title: 'You ended the interview',
    body: () => 'The round is over.',
    note: null,
    debrief: true,
  },
  technical: {
    title: 'Connection lost',
    body: () => 'The round ended because the connection dropped. You can go back to your interviews.',
    note: null,
    debrief: false,
  },
}

/** After the round (machine `ending`/`ended`), worded from how it ended (spec §10). */
export function EndedView({ sessionId, meta }: { sessionId: string; meta?: RoomMeta }) {
  const { state, ctx } = useLiveSession()

  if (state === 'ending' || !ctx.endedReason) {
    return (
      <RoomCentered className="items-center text-center">
        <div role="status" className="flex flex-col items-center gap-3">
          <Loader2 aria-hidden data-motion className="h-6 w-6 animate-spin text-faint" />
          <p className="m-0 text-[13.5px] text-muted-foreground">Ending the interview…</p>
        </div>
      </RoomCentered>
    )
  }

  const copy = COPY[ctx.endedReason]
  return (
    <RoomCentered>
      <div className="flex flex-col gap-2.5">
        <p className="iq-eyebrow m-0">{roomEyebrow(meta)}</p>
        <h1 className="m-0 text-[26px] font-normal leading-[1.1] tracking-[-0.04em] sm:text-[30px]">{copy.title}</h1>
        <p className="m-0 text-[15px] leading-[1.5] text-muted-foreground">{copy.body(ctx.endedMessage)}</p>
        {copy.note ? <p className="m-0 text-[14px] leading-[1.5] text-foreground">{copy.note}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {copy.debrief ? (
          <Button asChild className="h-11 px-5 text-[14px]">
            <Link href={`/interviews/${sessionId}/report`}>
              View debrief
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        ) : null}
        <Button asChild variant="strong" className="h-11 px-5 text-[14px]">
          <Link href="/interviews">Back to interviews</Link>
        </Button>
      </div>
    </RoomCentered>
  )
}
