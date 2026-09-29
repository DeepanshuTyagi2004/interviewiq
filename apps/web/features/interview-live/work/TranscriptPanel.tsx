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

/** Left-rail conversation transcript: both interviewer and candidate lines, plus proctoring
 * `system` notices styled distinctly so they never read as interviewer speech. Auto-scrolls to
 * the newest entry as the conversation grows. */
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
    <div className="flex h-full flex-col rounded border border-neutral-700 p-2">
      <h2 className="shrink-0 pb-1 text-sm font-semibold">Transcript</h2>
      <div
        ref={scrollRef}
        aria-label="Conversation transcript"
        role="log"
        className="min-h-0 flex-1 space-y-2 overflow-y-auto text-sm"
      >
        {entries.length === 0 ? (
          <p className="text-neutral-400 italic">The conversation will appear here.</p>
        ) : (
          entries.map((entry, i) => (
            <div
              key={i}
              className={cn(entry.speaker === 'system' && 'text-neutral-400 italic')}
            >
              <span className="font-semibold">{speakerLabel(entry.speaker, interviewerName)}: </span>
              <span>{entry.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
