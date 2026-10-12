# Task 4 report: How every edit arrived

Status: DONE. Commits: none (by rule). Tests: not run (user's standing rule).

## What I implemented

Per the controller's notes I did brief Steps 1, 3, 4, 5 and the "leave in working tree" step, and skipped Steps 2 and 6 (running tests).

- Step 1: wrote the three new test files with the brief's text verbatim.
- Step 3: wrote `activity/provenance.ts` verbatim (`TYPED_WINDOW_MS = 150`, `TYPED_MAX_CHARS = 16`, `UNATTRIBUTED_MIN_CHARS = 30`, `ChangeFacts`, `ProvenanceState`, `classifyChange`, `isUnattributed`, `ProvenanceDeps`, `createProvenance`). It imports `EditVia` from `../protocol/messages`, which Task 1 added (`export type EditVia = z.infer<typeof EditVia>` at messages.ts line 213; `via: EditVia.optional()` on the `Edit` schema at line 174).
- Step 4: `codeActivity.ts` now imports `EditVia`. It has a new exported `ContentEvent` interface. `ActivityEditor.onDidChangeModelContent` takes `(e: ContentEvent) => void`. `editEvents` takes an optional third argument `via` and spreads `via: via(c)` only when it is given. `attachCodeActivity` takes an optional fourth argument `classify(change, event)` and passes `classify && ((c) => classify(c, e))` to `editEvents`.
- Step 5: `batcher.ts` `edit()` merge condition now includes `last.via === e.via`.

## Files

Created, all under `/Users/salescode/Desktop/project/interviewiq/apps/web/features/interview-live/activity/`:
- `provenance.ts`
- `provenance.test.ts`
- `codeActivity.via.test.ts`
- `batcher.via.test.ts`

Modified, same directory:
- `codeActivity.ts`
- `batcher.ts`

I did not touch the existing `codeActivity.test.ts` or `batcher.test.ts`. I touched nothing under `apps/ai-service`. I did not commit, stage, stash or revert anything.

## Pre-edit checks

- `git status --short -- apps/web/features/interview-live/activity` printed nothing before I started. I re-checked `codeActivity.ts` and `batcher.ts` right before editing: unmodified, mtime Oct 9 12:50.
- I compared the brief's "old" text for Steps 4 and 5 against the real files: the import line, the `ActivityEditor` block, `editEvents`, the `attachCodeActivity` signature and subscription, and the `batcher.ts` merge condition. All matched exactly, and each `Edit` call applied with no mismatch.
- Only one consumer of the changed exports exists outside the activity directory: `work/CodeEditor.tsx` line 70 calls `attachCodeActivity(editor as unknown as ActivityEditor, record, isApplying)`. The new fourth parameter is optional, so it compiles and behaves as before (Task 8 will wire it).
- Files end with a newline, use single quotes and no semicolons, and contain no debug output.

## Deviations from the brief

None.

## Existing tests still hold (traced by reading)

Untagged edits behave exactly as before. When `via` is omitted, `editEvents` spreads `{}`, so the event has no `via` key at all. In `batcher.edit`, both `last.via` and `e.via` are `undefined`, so `undefined === undefined` is true and the merge condition reduces to the old one.

`codeActivity.test.ts`:
- `editEvents([change], false)` returns `{ k, from_line: 4, to_line: 5, ins: 200 x's, removed: 12 }` with no `via`, so `toEqual` passes. The flush case returns `[]`.
- The emoji test calls `editEvents([change], false)` and gets the same capped `ins`.
- The `attachCodeActivity(editor, record, isApplying)` tests pass three arguments, so `classify` is `undefined` and `classify && ...` is `undefined`. They record `['edit','caret','ptr','focus']`, nothing when `isApplying` is true, and dispose all four subscriptions.
- `fakeEditor` casts `on('content') as ActivityEditor['onDidChangeModelContent']`. The widened `ContentEvent` parameter does not break that cast.

`batcher.test.ts`:
- Every `edit(line, ins)` helper builds an event with no `via`, so merging works as before. The traced cases: the "merges quick edits" test (`[[1,'ab'],[2,'c'],[2,'d']]` and the 200-char cap), the caret-between-keystrokes test (`'abc'`), the emoji cap test, and `trimBatch`.

## Hand-trace of the new tests

`provenance.test.ts`:
- `classifyChange`, typed: with `lastKeyAt` 1000 and now 1150, the gap is 150, which is `<= TYPED_WINDOW_MS`. `'x'` is 1 char, `'()'` is 2 and `'\n    '` is 5, all `<= 16`, with no interviewer, paste or undo flags, so the result is `typed`.
- `classifyChange`, other: `lastKeyAt` null gives `other`. A gap of 151 gives `other`. A 40-char text with a 10 ms gap fails the `<= 16` check and gives `other`.
- `classifyChange`, known sources: `interviewerEditing` gives `interviewer`. `localPasting` with 50 chars gives `local_paste`, because that check comes before the typed check. `isUndoing` or `isRedoing` gives `undo`.
- `isUnattributed`: `other` with 30 chars is true, 29 is false. `typed` and `local_paste` are false at 100 chars.
- `createProvenance`, last key: `keyPressed()` at now=1000. At 1100 the gap is 100, so `typed`. At 1400 the gap is 400, so `other`.
- `createProvenance`, paste guard: inside `asLocalPaste`, `localPasting` is true and `classify` gives `local_paste` (`during`). The callback throws `boom`, `finally` resets the flag, and `toThrow('boom')` passes. Afterwards `classify` gives `other`, because `lastKeyAt` is null and `localPasting` is false.
- `createProvenance`, interviewer: with the interviewer flag on, `classify` gives `interviewer`.

`codeActivity.via.test.ts`:
- With `() => 'typed'`, `editEvents` returns the event including `via: 'typed'`, and `toEqual` matches exactly. Without it there is no `via` key.
- Attached: the subscription stores the callback in `handlers.content`. The handler is called with `isUndoing: true`, and `isApplying()` is false. `editEvents` calls `classify(change, e)`, which returns `'undo'`. `e` is the object passed in, so `objectContaining({ isUndoing: true })` matches and `change` is the same reference. The recorded event has `k: 'edit'` and `via: 'undo'`.

`batcher.via.test.ts` (the injected `now` is a plain counter, so there are no fake timers; `record()` arms a real 500 ms timer that `flush()` clears):
- Same tag: `typed` at t=1000, `typed` at t=1100. The lines match, `via` is equal and 100 < 300, so they merge to `ins: 'abab'` with `via: 'typed'`. One event is sent.
- Different tags: `typed` then `other` fail `last.via === e.via`, so both are pushed. The via list is `['typed','other']`.
- No tag: `undefined === undefined`, so they merge into 1 event.

## Concerns

- TypeScript typing was checked by reading only. `classify && ((c) => classify(c, e))` relies on `classify` staying narrowed inside the closure. That holds because it is a parameter that is never reassigned, and it is the brief's own code. In `codeActivity.via.test.ts`, `vi.fn(() => 'undo' as const)` is a zero-argument mock passed where a two-argument function is expected. That is assignable.
- Task 8 still has to wire `createProvenance` into `CodeEditor.tsx`, passing `classify` as the fourth `attachCodeActivity` argument. This task does not do that.
