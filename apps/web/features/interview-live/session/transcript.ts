/**
 * The room's conversation as segments. LiveKit Agents streams each utterance as a segment: interim
 * words update it in place until a final version locks it.
 */
export type TranscriptSpeaker = 'interviewer' | 'candidate' | 'system'

export interface TranscriptSegment {
  id: string
  speaker: TranscriptSpeaker
  text: string
  final: boolean
  /** When the segment first arrived (ms since epoch). */
  at: number
}

/** Inserts a segment or updates it by id. A final segment ignores later interim updates. */
export function applySegment(list: TranscriptSegment[], seg: TranscriptSegment): TranscriptSegment[] {
  const i = list.findIndex((s) => s.id === seg.id)
  if (i === -1) return [...list, seg]
  const prev = list[i]
  if (prev.final && !seg.final) return list
  const next = list.slice()
  next[i] = { ...seg, at: prev.at }
  return next
}

let notes = 0

/** A centred room notice (proctoring, connection) in the transcript. */
export function systemNote(text: string, at: number = Date.now()): TranscriptSegment {
  notes += 1
  return { id: `note-${at}-${notes}`, speaker: 'system', text, final: true, at }
}
