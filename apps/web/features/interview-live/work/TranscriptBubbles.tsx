'use client'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils/cn'
import type { TranscriptSegment } from '../session/transcript'

/** The conversation as chat bubbles: the interviewer on the left, the candidate on the right, interim
 * words dimmed until final, room notices as centred mono chips. Follows the newest line. */
export function TranscriptBubbles({ segments, interviewerName }: { segments: TranscriptSegment[]; interviewerName: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const last = segments[segments.length - 1]

  // DOM write, not state: scrolling to the newest line doesn't belong in component state.
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [segments.length, last?.text])

  return (
    <div
      ref={ref}
      role="log"
      aria-label="Conversation transcript"
      tabIndex={0}
      className="flex h-full min-h-0 flex-col gap-1.5 overflow-y-auto py-2 text-[13.5px] leading-[1.5] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {segments.length === 0 ? (
        <p className="m-auto text-center text-[13px] text-faint">The conversation will appear here.</p>
      ) : (
        segments.map((s, i) => {
          if (s.speaker === 'system') {
            return (
              <p key={s.id} role="note" className="m-0 my-1 self-center rounded-full border border-dashed border-line-4 px-2.5 py-1 text-center font-mono text-[10.5px] uppercase tracking-[0.06em] text-faint">
                {s.text}
              </p>
            )
          }
          const mine = s.speaker === 'candidate'
          const runStart = i === 0 || segments[i - 1].speaker !== s.speaker
          return (
            <div key={s.id} className={cn('flex max-w-[88%] flex-col', mine ? 'items-end self-end' : 'items-start self-start')}>
              {runStart ? (
                <span className="mb-0.5 px-1 font-mono text-[9.5px] uppercase tracking-[0.08em] text-faint">{mine ? 'You' : interviewerName}</span>
              ) : null}
              <p
                data-final={s.final}
                className={cn(
                  'm-0 whitespace-pre-wrap rounded-[16px] px-3 py-2',
                  mine ? 'rounded-br-[6px] bg-inv text-white' : 'rounded-bl-[6px] bg-panel text-foreground',
                  !s.final && 'opacity-70',
                )}
              >
                {s.text}
              </p>
            </div>
          )
        })
      )}
    </div>
  )
}
