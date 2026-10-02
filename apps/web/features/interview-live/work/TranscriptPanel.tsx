'use client'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils/cn'
import type { TranscriptEntry } from '../session/types'

interface TranscriptPanelProps {
  entries: TranscriptEntry[]
  interviewerName: string
}

function speakerLabel(speaker: TranscriptEntry['speaker'], interviewerName: string): string {
  if (speaker === 'interviewer') return interviewerName
  if (speaker === 'candidate') return 'You'
  return 'System'
}

/** Conversation transcript in the design's style: interviewer turns on a soft panel, the
 * candidate's in muted text, each under a small mono speaker label. Proctoring `system` notices
 * get a dashed outline so they never read as interviewer speech. Auto-scrolls to the newest
 * entry as the conversation grows. */
export function TranscriptPanel({ entries, interviewerName }: TranscriptPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // DOM write, not React state — scrolling the container to its latest content doesn't belong in
  // component state, so this doesn't trip react-hooks/set-state-in-effect.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [entries.length])

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <h2 className="iq-eyebrow m-0 shrink-0 px-1 font-normal">Transcript</h2>
      <div
        ref={scrollRef}
        aria-label="Conversation transcript"
        role="log"
        tabIndex={0}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-[9px] text-[13.5px] leading-[1.5] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {entries.length === 0 ? (
          <p className="m-0 px-1 text-[13px] text-faint">The conversation will appear here.</p>
        ) : (
          entries.map((entry, i) => (
            <div
              key={i}
              className={cn(
                'rounded-[11px] px-3 py-2.5',
                entry.speaker === 'interviewer' && 'bg-panel text-foreground',
                entry.speaker === 'candidate' && 'text-muted-foreground',
                entry.speaker === 'system' && 'border border-dashed border-line-4 text-faint'
              )}
            >
              <span className="mb-[3px] block font-mono text-[9.5px] uppercase tracking-[0.08em] text-faint">
                {speakerLabel(entry.speaker, interviewerName)}
              </span>
              <span>{entry.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
