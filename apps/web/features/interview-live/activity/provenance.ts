/**
 * How each change to the code arrived (live integrity spec §6.1). A change is "typed" when a key was pressed a moment
 * before it and it is short enough to be that key's work: the character, an auto-closed pair, an auto-indent.
 */
import type { EditVia } from '../protocol/messages'

export const TYPED_WINDOW_MS = 150
export const TYPED_MAX_CHARS = 16
/** A change this long with no known source is an unattributed insert (an extension, dictation, an input method). */
export const UNATTRIBUTED_MIN_CHARS = 30

export interface ChangeFacts {
  text: string
  isUndoing?: boolean
  isRedoing?: boolean
}

export interface ProvenanceState {
  lastKeyAt: number | null
  localPasting: boolean
  interviewerEditing: boolean
}

export function classifyChange(c: ChangeFacts, s: ProvenanceState, now: number): EditVia {
  if (s.interviewerEditing) return 'interviewer'
  if (s.localPasting) return 'local_paste'
  if (c.isUndoing || c.isRedoing) return 'undo'
  if (s.lastKeyAt !== null && now - s.lastKeyAt <= TYPED_WINDOW_MS && c.text.length <= TYPED_MAX_CHARS) return 'typed'
  return 'other'
}

export function isUnattributed(via: EditVia, text: string): boolean {
  return via === 'other' && text.length >= UNATTRIBUTED_MIN_CHARS
}

export interface ProvenanceDeps {
  now(): number
  /** True while the interviewer's own edit is being applied (the code adapter's `isApplying`). */
  interviewerEditing(): boolean
}

/** One per editor: the key listener and the paste guard set the flags, the change handlers read them. */
export function createProvenance(deps: ProvenanceDeps) {
  let lastKeyAt: number | null = null
  let localPasting = false
  return {
    keyPressed(): void {
      lastKeyAt = deps.now()
    },
    asLocalPaste(fn: () => void): void {
      localPasting = true
      try {
        fn()
      } finally {
        localPasting = false
      }
    },
    classify(c: ChangeFacts): EditVia {
      return classifyChange(c, { lastKeyAt, localPasting, interviewerEditing: deps.interviewerEditing() }, deps.now())
    },
  }
}
