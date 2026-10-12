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
  /** When the browser last delivered a paste or drop into the editor (only seen when the clipboard rules are off). */
  lastDomInsertAt?: number | null
  localPasting: boolean
  interviewerEditing: boolean
}

/** True when something the candidate did (a key press, or in dev a native paste or drop) happened a moment before `now`. */
export function hadRecentInput(s: ProvenanceState, now: number): boolean {
  const recent = (at: number | null | undefined) => at !== null && at !== undefined && now - at <= TYPED_WINDOW_MS
  return recent(s.lastKeyAt) || recent(s.lastDomInsertAt)
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
  let lastDomInsertAt: number | null = null
  let localPasting = false
  const state = (): ProvenanceState => ({ lastKeyAt, lastDomInsertAt, localPasting, interviewerEditing: deps.interviewerEditing() })
  return {
    keyPressed(): void {
      lastKeyAt = deps.now()
    },
    /** A paste or drop reached the editor natively (dev builds): the text is not "inserted with no key". */
    domInserted(): void {
      lastDomInsertAt = deps.now()
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
      return classifyChange(c, state(), deps.now())
    },
    /** How the change arrived, and whether a key (or native paste) came just before it, whatever its size. */
    analyze(c: ChangeFacts): { via: EditVia; keyed: boolean } {
      const s = state()
      const now = deps.now()
      return { via: classifyChange(c, s, now), keyed: hadRecentInput(s, now) }
    },
  }
}
