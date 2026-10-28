'use client'
import { useState } from 'react'
import { StatusDot } from '@/components/hud'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils/cn'
import type { SectionKind } from '../protocol/messages'
import type { ProblemCard } from '../workspace/panel'
import { useWorkspace } from '../workspace/WorkspaceProvider'
import { RichText } from './RichText'

const KIND_LABEL: Record<SectionKind, string> = {
  constraints: 'Constraints',
  format: 'Input and output',
  clarification: 'Clarification',
  hint: 'Hint',
  explanation: 'Explanation',
  note: 'Note',
}

/** Sections either side added to a problem, with their author; the candidate can add notes. */
export function Sections({ card }: { card: ProblemCard }) {
  const { addNote } = useWorkspace()
  const [draft, setDraft] = useState<string | null>(null)
  const noteId = `note-${card.itemId}`

  return (
    <div className="mt-5 flex flex-col gap-2.5">
      {card.sections.map((s) => (
        <article
          key={s.id}
          aria-label={KIND_LABEL[s.kind]}
          className={cn('rounded-[11px] border px-3 py-2.5', s.author === 'interviewer' ? 'border-brand/30' : 'border-line-2')}
        >
          <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.08em]">
            <span className="text-foreground">{KIND_LABEL[s.kind]}</span>
            <span aria-hidden className="h-px flex-1 bg-line-2" />
            <StatusDot
              state={s.author === 'interviewer' ? 'active' : 'idle'}
              label={s.author === 'interviewer' ? 'Interviewer' : 'You'}
              className="text-muted-foreground"
            />
          </div>
          {s.title !== KIND_LABEL[s.kind] ? <p className="m-0 mt-1.5 text-[13px] font-medium">{s.title}</p> : null}
          <p className="m-0 mt-1 whitespace-pre-wrap text-[13.5px] leading-[1.55] text-foreground"><RichText text={s.body} /></p>
        </article>
      ))}
      {draft === null ? (
        <button
          type="button"
          onClick={() => setDraft('')}
          className="self-start rounded-full border border-line-3 px-3 py-1 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
        >
          Add a note
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const body = draft.trim()
            if (body) addNote(card.itemId, body)
            setDraft(null)
          }}
          className="flex flex-col gap-2"
        >
          <label htmlFor={noteId} className="sr-only">Note</label>
          <Textarea id={noteId} value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} maxLength={4000} className="text-[13.5px]" autoFocus />
          <div className="flex gap-2">
            <Button type="submit" className="h-8 px-3 text-[12.5px]">Save note</Button>
            <Button type="button" variant="ghost" className="h-8 px-3 text-[12.5px]" onClick={() => setDraft(null)}>Cancel</Button>
          </div>
        </form>
      )}
    </div>
  )
}
