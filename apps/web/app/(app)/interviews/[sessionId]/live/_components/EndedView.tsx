'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLiveSession } from '@/features/interview-live/session/useLiveSession'
import { RoomCentered } from './RoomFrame'
import { roomEyebrow, type RoomMeta } from './roomMeta'

/** Shown once the interview has ended (machine states `ending`/`ended`): a hand-off to the
 * debrief, worded from how the round actually ended (the machine's `endedReason`). */
export function EndedView({ sessionId, meta }: { sessionId: string; meta?: RoomMeta }) {
  const { ctx } = useLiveSession()
  const droppedOut = ctx.endedReason === 'aborted_technical'

  return (
    <RoomCentered>
      <div className="flex flex-col gap-2.5">
        <p className="iq-eyebrow m-0">{roomEyebrow(meta)}</p>
        <h1 className="m-0 text-[26px] font-normal leading-[1.1] tracking-[-0.04em] sm:text-[30px]">
          {droppedOut ? 'The interview was cut short' : 'Interview ended'}
        </h1>
        <p className="m-0 text-[15px] leading-[1.5] text-muted-foreground">
          {droppedOut
            ? 'The connection dropped, so the round ended early. You can book it again from your interviews.'
            : "Thanks for taking the round. Its debrief has its own page; scoring isn't live yet, so it won't show a score for now."}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild className="h-11 px-5 text-[14px]">
          <Link href={`/interviews/${sessionId}/report`}>
            View debrief
            <ArrowRight aria-hidden />
          </Link>
        </Button>
        <Button asChild variant="strong" className="h-11 px-5 text-[14px]">
          <Link href="/interviews">Back to interviews</Link>
        </Button>
      </div>
    </RoomCentered>
  )
}
