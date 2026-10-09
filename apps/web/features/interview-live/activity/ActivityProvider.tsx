'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ActivityEventBody } from '../protocol/messages'
import type { LiveSession } from '../session/types'
import { ActivityBatcher } from './batcher'

interface ActivityCtx {
  record(e: ActivityEventBody): void
}

const Ctx = createContext<ActivityCtx>({ record: () => {} })

/** What the candidate does in the workspace, reported to the interviewer (spec §5). Panes call `record`; the batcher
 * decides what is sent and when. Mounted only while the live room is, so nothing is captured outside it. */
export function ActivityProvider({ session, children }: { session: LiveSession; children: React.ReactNode }) {
  const [batcher] = useState(
    () =>
      new ActivityBatcher({
        now: () => Date.now(),
        send: (batch) => {
          try {
            session.send({ type: 'activity.batch', sent_at: batch.sent_at, events: batch.events })
          } catch {
            // disconnected: this stretch of activity is simply lost, the round goes on
          }
        },
      }),
  )
  useEffect(() => {
    batcher.start()
    return () => batcher.stop()
  }, [batcher])
  const record = useCallback((e: ActivityEventBody) => batcher.record(e), [batcher])
  const value = useMemo(() => ({ record }), [record])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useActivity(): ActivityCtx {
  return useContext(Ctx)
}

/** A `<section>` that tells the interviewer when the pointer leaves it (used for the whole workspace). */
export function ActivityPane({ onMouseLeave, ...rest }: React.ComponentProps<'section'>) {
  const { record } = useActivity()
  return (
    <section
      {...rest}
      onMouseLeave={(e) => {
        onMouseLeave?.(e)
        record({ k: 'ptr', s: 'out' })
      }}
    />
  )
}
