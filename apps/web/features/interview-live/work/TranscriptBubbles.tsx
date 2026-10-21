'use client'
import { useCallback, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils/cn'
import type { TranscriptSegment } from '../session/transcript'

/** The conversation as a clean caption column: each run of lines under a small speaker label, the interviewer in
 * ink and the candidate in a softer ink behind a hairline, interim words dimmed until final, room notices as
 * centred pills. Follows the newest line. `comfortable` sets the type a little larger, for when the conversation
 * has the room to itself. (Name kept from the chat-bubble version.) */
export function TranscriptBubbles({ segments, interviewerName, comfortable = false }: { segments: TranscriptSegment[]; interviewerName: string; comfortable?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const last = segments[segments.length - 1]

  // DOM write, not state: scrolling to the newest line doesn't belong in component state.
  const scrollToEnd = useCallback(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])
  useEffect(() => {
    scrollToEnd()
  }, [scrollToEnd, segments.length, last?.text, comfortable])

  return (
    <div
      ref={ref}
      role="log"
      aria-label="Conversation transcript"
      tabIndex={0}
      onTransitionEnd={scrollToEnd} // the type size animates with the room's layout change; once it settles the text has re-wrapped
      className={cn(
        'flex h-full min-h-0 flex-col gap-1.5 overflow-y-auto rounded-md py-2 transition-[font-size,line-height] duration-500 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none',
        comfortable ? 'text-[15.5px] leading-[1.55]' : 'text-[13.5px] leading-[1.5]',
      )}
    >
      {segments.length === 0 ? (
        <p className="m-auto text-center text-[13px] text-ink-3">The conversation will appear here.</p>
      ) : (
        segments.map((s, i) => {
          if (s.speaker === 'system') {
            return (
              <p key={s.id} role="note" className="m-0 my-1 self-center rounded-full bg-surface-2 px-3 py-1 text-center text-[12px] text-ink-2">
                {s.text}
              </p>
            )
          }
          const mine = s.speaker === 'candidate'
          const runStart = i === 0 || segments[i - 1].speaker !== s.speaker
          return (
            <div key={s.id} className={cn('flex flex-col', mine && 'border-l-2 border-line pl-3')}>
              {runStart ? (
                <span className="mb-0.5 mt-1.5 text-[11.5px] font-medium text-ink-3">{mine ? 'You' : interviewerName}</span>
              ) : null}
              <p
                data-final={s.final}
                className={cn(
                  'm-0 whitespace-pre-wrap',
                  mine ? 'text-ink-2' : 'text-foreground',
                  !s.final && 'opacity-60',
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
