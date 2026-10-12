### Task 4: How every edit arrived

**Files:**
- Create: `apps/web/features/interview-live/activity/provenance.ts`
- Test: `apps/web/features/interview-live/activity/provenance.test.ts`, `codeActivity.via.test.ts`, `batcher.via.test.ts`
- Modify: `apps/web/features/interview-live/activity/codeActivity.ts`, `batcher.ts`

**Interfaces:**
- Consumes (Task 1): `EditVia` from `protocol/messages`.
- Produces: `TYPED_WINDOW_MS = 150`, `TYPED_MAX_CHARS = 16`, `UNATTRIBUTED_MIN_CHARS = 30`; `ChangeFacts { text: string; isUndoing?: boolean; isRedoing?: boolean }`; `classifyChange(c, state, now): EditVia`; `isUnattributed(via, text): boolean`; `createProvenance({ now, interviewerEditing }): { keyPressed(): void; asLocalPaste(fn): void; classify(c: ChangeFacts): EditVia }`. `ContentEvent`; `editEvents(changes, isFlush, via?)`; `attachCodeActivity(editor, record, isApplying, classify?)` where `classify: (change: ChangeLike, event: ContentEvent) => EditVia`.

- [ ] **Step 1: Write the failing tests**

Create `provenance.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { TYPED_WINDOW_MS, classifyChange, createProvenance, isUnattributed, type ProvenanceState } from './provenance'

const idle: ProvenanceState = { lastKeyAt: null, localPasting: false, interviewerEditing: false }

describe('classifyChange', () => {
  it('calls a short change right after a key press typed', () => {
    expect(classifyChange({ text: 'x' }, { ...idle, lastKeyAt: 1000 }, 1000 + TYPED_WINDOW_MS)).toBe('typed')
    expect(classifyChange({ text: '()' }, { ...idle, lastKeyAt: 1000 }, 1050)).toBe('typed')        // an auto-closed pair
    expect(classifyChange({ text: '\n    ' }, { ...idle, lastKeyAt: 1000 }, 1050)).toBe('typed')    // Enter with auto-indent
  })

  it('calls a change with no key shortly before it other', () => {
    expect(classifyChange({ text: 'x' }, idle, 5000)).toBe('other')
    expect(classifyChange({ text: 'x' }, { ...idle, lastKeyAt: 1000 }, 1000 + TYPED_WINDOW_MS + 1)).toBe('other')
  })

  it('does not call a long change typed even right after a key press', () => {
    expect(classifyChange({ text: 'x'.repeat(40) }, { ...idle, lastKeyAt: 1000 }, 1010)).toBe('other')
  })

  it('names the known sources first, whatever keys were pressed', () => {
    const keyed = { ...idle, lastKeyAt: 1000 }
    expect(classifyChange({ text: 'x' }, { ...keyed, interviewerEditing: true }, 1010)).toBe('interviewer')
    expect(classifyChange({ text: 'x'.repeat(50) }, { ...keyed, localPasting: true }, 1010)).toBe('local_paste')
    expect(classifyChange({ text: 'x', isUndoing: true }, keyed, 1010)).toBe('undo')
    expect(classifyChange({ text: 'x', isRedoing: true }, keyed, 1010)).toBe('undo')
  })
})

describe('isUnattributed', () => {
  it('is an unexplained change of 30 or more characters', () => {
    expect(isUnattributed('other', 'x'.repeat(30))).toBe(true)
    expect(isUnattributed('other', 'x'.repeat(29))).toBe(false)
    expect(isUnattributed('typed', 'x'.repeat(100))).toBe(false)
    expect(isUnattributed('local_paste', 'x'.repeat(100))).toBe(false)
  })
})

describe('createProvenance', () => {
  function make() {
    let now = 1000
    let interviewer = false
    const p = createProvenance({ now: () => now, interviewerEditing: () => interviewer })
    return { p, at: (t: number) => { now = t }, interviewer: (on: boolean) => { interviewer = on } }
  }

  it('remembers the last key press', () => {
    const { p, at } = make()
    p.keyPressed()
    at(1100)
    expect(p.classify({ text: 'a' })).toBe('typed')
    at(1400)
    expect(p.classify({ text: 'a' })).toBe('other')
  })

  it('tags changes made inside asLocalPaste, and only those, even if the paste throws', () => {
    const { p } = make()
    let during = ''
    expect(() => p.asLocalPaste(() => { during = p.classify({ text: 'pasted' }); throw new Error('boom') })).toThrow('boom')
    expect(during).toBe('local_paste')
    expect(p.classify({ text: 'pasted' })).toBe('other')
  })

  it('asks the editor adapter whether the interviewer is editing', () => {
    const { p, interviewer } = make()
    interviewer(true)
    expect(p.classify({ text: 'stub' })).toBe('interviewer')
  })
})
```

Create `codeActivity.via.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { ActivityEventBody } from '../protocol/messages'
import { attachCodeActivity, editEvents, type ActivityEditor, type ChangeLike, type ContentEvent } from './codeActivity'

const change: ChangeLike = { range: { startLineNumber: 3, endLineNumber: 3 }, text: 'x', rangeLength: 0 }

describe('edit events carry how they arrived', () => {
  it('adds via when asked and leaves old callers untouched', () => {
    expect(editEvents([change], false, () => 'typed')).toEqual([{ k: 'edit', from_line: 3, to_line: 3, ins: 'x', removed: 0, via: 'typed' }])
    expect(editEvents([change], false)).toEqual([{ k: 'edit', from_line: 3, to_line: 3, ins: 'x', removed: 0 }])
  })

  it('passes the change and the editor event to the classifier when attached', () => {
    const handlers: { content?: (e: ContentEvent) => void } = {}
    const none = () => ({ dispose() {} })
    const editor: ActivityEditor = {
      getModel: () => null,
      getSelection: () => null,
      onDidChangeModelContent: (cb) => { handlers.content = cb; return { dispose() {} } },
      onDidChangeCursorSelection: none,
      onMouseMove: none,
      onDidFocusEditorText: none,
    }
    const seen: ActivityEventBody[] = []
    const classify = vi.fn(() => 'undo' as const)
    attachCodeActivity(editor, (e) => seen.push(e), () => false, classify)
    handlers.content!({ changes: [change], isFlush: false, isUndoing: true })
    expect(classify).toHaveBeenCalledWith(change, expect.objectContaining({ isUndoing: true }))
    expect(seen).toEqual([expect.objectContaining({ k: 'edit', via: 'undo' })])
  })
})
```

Create `batcher.via.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ActivityBatcher, type BatchOut } from './batcher'

function make() {
  let t = 1_000
  const sent: BatchOut[] = []
  const batcher = new ActivityBatcher({ now: () => t, send: (b) => sent.push(b) })
  return { batcher, advance: (ms: number) => { t += ms }, sent }
}
const edit = (via?: 'typed' | 'other') => ({ k: 'edit' as const, from_line: 3, to_line: 3, ins: 'ab', removed: 0, ...(via ? { via } : {}) })

describe('merging edits', () => {
  it('merges consecutive edits that arrived the same way', () => {
    const { batcher, advance, sent } = make()
    batcher.record(edit('typed'))
    advance(100)
    batcher.record(edit('typed'))
    batcher.flush()
    expect(sent[0].events).toEqual([expect.objectContaining({ k: 'edit', ins: 'abab', via: 'typed' })])
  })

  it('keeps edits that arrived differently apart, so a paste is never hidden inside typing', () => {
    const { batcher, advance, sent } = make()
    batcher.record(edit('typed'))
    advance(100)
    batcher.record(edit('other'))
    batcher.flush()
    expect(sent[0].events.map((e) => (e.k === 'edit' ? e.via : null))).toEqual(['typed', 'other'])
  })

  it('still merges edits that carry no tag', () => {
    const { batcher, advance, sent } = make()
    batcher.record(edit())
    advance(100)
    batcher.record(edit())
    batcher.flush()
    expect(sent[0].events).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail** (when the user has said to run tests)

Run (from `apps/web`): `pnpm exec vitest run features/interview-live/activity/provenance.test.ts features/interview-live/activity/codeActivity.via.test.ts features/interview-live/activity/batcher.via.test.ts`
Expected: FAIL (`./provenance` not found; `editEvents` ignores a third argument; differing `via` edits merge).

- [ ] **Step 3: Write `provenance.ts`**

```ts
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
```

- [ ] **Step 4: Tag the edit events**

In `codeActivity.ts`: change the type import to `import type { ActivityEventBody, EditVia } from '../protocol/messages'`.

Directly above `export interface ActivityEditor {` add:

```ts
export interface ContentEvent {
  changes: readonly ChangeLike[]
  isFlush: boolean
  isUndoing?: boolean
  isRedoing?: boolean
}
```

and change the `onDidChangeModelContent` line inside `ActivityEditor` to:

```ts
  onDidChangeModelContent(cb: (e: ContentEvent) => void): Disposable
```

Replace `editEvents` with:

```ts
export function editEvents(changes: readonly ChangeLike[], isFlush: boolean, via?: (change: ChangeLike) => EditVia): ActivityEventBody[] {
  if (isFlush) return []
  return changes.map((c) => ({
    k: 'edit' as const, from_line: c.range.startLineNumber, to_line: c.range.endLineNumber, ins: capCodePoints(c.text, MAX_INS), removed: c.rangeLength,
    ...(via ? { via: via(c) } : {}),
  }))
}
```

Replace the start of `attachCodeActivity` (signature and the content subscription) with:

```ts
export function attachCodeActivity(
  editor: ActivityEditor,
  record: (e: ActivityEventBody) => void,
  isApplying: () => boolean,
  classify?: (change: ChangeLike, event: ContentEvent) => EditVia,
): () => void {
  const subs = [
    editor.onDidChangeModelContent((e) => {
      if (isApplying()) return
      for (const ev of editEvents(e.changes, e.isFlush, classify && ((c) => classify(c, e)))) record(ev)
    }),
```

(the other subscriptions are unchanged).

- [ ] **Step 5: Merge only equal tags**

In `batcher.ts`, in `edit()`, change the merge condition to include the tag:

```ts
    if (last?.k === 'edit' && last.from_line === e.from_line && last.to_line === e.to_line && last.via === e.via && e.t - last.t < EDIT_MERGE_MS) {
```

- [ ] **Step 6: Run the tests to verify they pass** (when the user has said to run tests)

Run (from `apps/web`): `pnpm exec vitest run features/interview-live/activity`
Expected: PASS, including the existing `codeActivity` and `batcher` tests (untagged edits behave as before).

- [ ] **Step 7: Leave the files in the working tree** (no commit): `provenance.ts`, the three new test files, `codeActivity.ts`, `batcher.ts`.

---

