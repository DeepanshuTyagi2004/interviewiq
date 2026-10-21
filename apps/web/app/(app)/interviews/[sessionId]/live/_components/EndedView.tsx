'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Orb } from '@/components/ds'
import { Button } from '@/components/ui/button'
import { BarsMascot } from '@/components/mascot/BarsMascot'
import type { EndReason } from '@/features/interview-live/protocol/messages'
import { useLiveSession } from '@/features/interview-live/session/useLiveSession'
import { RoomCentered } from './RoomFrame'
import { roomEyebrow, type RoomMeta } from './roomMeta'

const COPY: Record<EndReason, { title: string; body: (message: string | null) => string; note: string | null; debrief: boolean }> = {
  completed: {
    title: 'Interview complete',
    body: (m) => m ?? 'Thanks for taking the round.',
    note: null,
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
        <div role="status" className="flex flex-col items-center gap-4 py-6">
          <Orb seed="ending" size={56} state="breathing" />
          <p className="m-0 text-[13.5px] text-ink-2">Ending the interview…</p>
        </div>
      </RoomCentered>
    )
  }

  const copy = COPY[ctx.endedReason]
  return (
    <RoomCentered className="items-center text-center">
      {/* The mascot bounces a little past its box, so nothing around it clips and it has room above and below. */}
      <div className="flex justify-center px-6 pb-3 pt-4">
        <BarsMascot mood="idle" size={104} />
      </div>
      <div className="flex flex-col items-center gap-2.5">
        <p className="m-0 text-[13px] text-ink-3">{roomEyebrow(meta)}</p>
        <h1 className="m-0 font-display text-[28px] font-light leading-[1.1] tracking-[-0.035em] sm:text-[34px]">{copy.title}</h1>
        <p className="m-0 max-w-[460px] text-[15px] leading-[1.5] text-ink-2">{copy.body(ctx.endedMessage)}</p>
        {copy.note ? <p className="m-0 text-[14px] leading-[1.5] text-foreground">{copy.note}</p> : null}
        {copy.debrief ? <p className="m-0 text-[14px] leading-[1.5] text-foreground">Your report is being prepared — usually a few minutes.</p> : null}
      </div>
      <div className="flex flex-wrap justify-center gap-2 pt-1">
        {copy.debrief ? (
          <Button asChild className="h-11 px-6 text-[14px]">
            <Link href={`/interviews/${sessionId}/report`}>
              View debrief
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        ) : null}
        <Button asChild variant="outline" className="h-11 px-6 text-[14px]">
          <Link href="/interviews">Back to interviews</Link>
        </Button>
      </div>
    </RoomCentered>
  )
}
