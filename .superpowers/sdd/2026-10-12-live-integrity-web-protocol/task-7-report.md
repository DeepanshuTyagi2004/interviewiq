# Task 7 report: countdown bar and foreign-paste action in the room

Status: DONE. Commits: none (by rule). Tests: not run (user's standing rule).

## What I implemented

Brief steps 1, 3, 4, 5 and 7 (steps 2 and 6, the test runs, skipped per the controller notes).

- `ProctorContext.tsx` (new): `ProctorActions { foreignPaste(info: ForeignInsert): void }`, a context whose default is a no-op,
  `ProctorActionsProvider = Ctx.Provider`, and `useProctorActions()`. Verbatim from the brief.
- `ProctorBars.tsx` (modified): imports `AwayEpisode` and `useAwayCountdown`; new optional prop `away?: AwayEpisode | null`
  (default `null`); `const clock = useAwayCountdown(away)` beside the `shareError` state; a `role="status"` countdown bar is
  rendered right before the `outOfFullscreen` bar (phase `limit`: "Return to the interview within N s. After that it counts as
  another violation."; phase `cap`: "Return now. The interview ends in N s."); the doc comment now ends "...and a countdown while
  the candidate is away. The round keeps running." The presence bar, toast, full-screen bar and share bar are untouched.
- `LiveView.tsx` (modified): added `import { useEffect, useMemo } from 'react'` (there was no react import before) and the three
  proctor imports (`attachRoomCopyGuard`, `clipboardRulesActive` + `forgetBuffer`, `ProctorActionsProvider`); after
  `useProctor(...)` added the memoised `proctorActions` and the effect that attaches the room copy guard to `document` only while
  `clipboardRulesActive()` and, on cleanup, detaches it and calls `forgetBuffer()`; wrapped the returned tree in
  `<ProctorActionsProvider value={proctorActions}>` around the existing `<ActivityProvider>` (inner content re-indented by two
  spaces; tags balanced: Provider > ActivityProvider > WorkspaceProvider > div, closed in reverse); `ProctorBars` now receives
  `away={proctor.away}`.
- `ProctorBars.test.tsx` and `ProctorContext.test.tsx` (new): brief text verbatim.

## Files

Created:
- /Users/salescode/Desktop/project/interviewiq/apps/web/features/interview-live/proctor/ProctorContext.tsx
- /Users/salescode/Desktop/project/interviewiq/apps/web/features/interview-live/proctor/ProctorContext.test.tsx
- /Users/salescode/Desktop/project/interviewiq/apps/web/features/interview-live/proctor/ProctorBars.test.tsx

Modified:
- /Users/salescode/Desktop/project/interviewiq/apps/web/features/interview-live/proctor/ProctorBars.tsx
- /Users/salescode/Desktop/project/interviewiq/apps/web/app/(app)/interviews/[sessionId]/live/_components/LiveView.tsx

Both modified files were unmodified in git before I started (checked with `git status --short` twice, the second time right
before editing LiveView).

## Deviations

None. Style check: LiveView.tsx already uses single quotes and no semicolons (despite living under `app/`), so the brief's code
matches the file as is.

## Confirmed exports and shapes (read, not run)

- `AwayEpisode { startedAt, kinds, tight }`, `countdown()`, `Countdown { phase: 'limit' | 'cap', seconds }` in awayEpisode.ts.
- `useAwayCountdown(away: AwayEpisode | null): Countdown | null` in useAwayCountdown.ts.
- `ForeignInsert { source: 'paste' | 'drop'; chars; lines }` and `attachRoomCopyGuard(doc)` (returns a detach function) in
  editorClipboard.ts; `document` satisfies its `Pick<Document, ...>` parameter.
- `clipboardRulesActive()` and `forgetBuffer()` in localClipboard.ts.
- `useProctor` returns `away: AwayEpisode | null` and `foreignPaste` (a `useCallback`, so the `useMemo` in LiveView is stable).
- The only other `ProctorBars` consumer is `controls/RoomChrome.test.tsx`; it does not pass `away`, which defaults to `null`, so
  the new hook returns `null` and it renders no extra bar. No other test mocks the proctor modules.

## Hand-trace of the tests

ProctorBars.test.tsx (fake timers; `useAwayCountdown` seeds `now` from `Date.now()` and, when `away` is set, re-reads it and
ticks every 1 s):
- "counts down to the limit, then to the end": episode starts at the faked `Date.now()`, `tight: true` so the limit is 15 s.
  First render: elapsed 0, phase `limit`, seconds `ceil(15 - 0)` = 15, so "Return to the interview within 15 s. After that..."
  matches `/Return to the interview within 15 s/`. After `advanceTimersByTime(20_000)` inside `act`, the 20 interval ticks call
  `setNow(Date.now())` against the faked clock; elapsed 20 >= 15 so phase `cap`, seconds `ceil(60 - 20)` = 40, text "Return now.
  The interview ends in 40 s." matches `/Return now\. The interview ends in 40 s/`. Consistent.
- "says nothing about time while on the screen": `away` null makes `clock` null, no countdown bar; `outOfFullscreen` false, so no
  button text; presence defaults to `present`. Nothing contains "Return", so `queryByText(/Return/)` is null. Consistent.
- "still shows the return-to-full-screen bar beside the countdown": `outOfFullscreen` true renders `Bar` with a button named
  "Return to full screen" (found by `getByRole('button', ...)`); `tight: false` gives limit 30 s, so the countdown text contains
  "within 30 s"; the `Bar` text ("You're out of full screen. Leaving it is counted.") does not match `/within 30 s/`, so
  `getByText` finds exactly one element. Consistent.

ProctorContext.test.tsx:
- "no-op outside the live room": no provider, so the default context value `{ foreignPaste: () => {} }` is used; calling it does
  not throw. Consistent.
- "hands the room its actions": the wrapper supplies `{ foreignPaste }` (the mock) via `ProctorActionsProvider`;
  `useProctorActions()` returns that object; the call is recorded with the same argument. Consistent.

LiveView.test.tsx (existing, must keep working): under vitest `NODE_ENV` is `test` and `NEXT_PUBLIC_ENFORCE_CLIPBOARD` is not
set, so `clipboardRulesActive()` is false, the effect returns early and nothing is attached or forgotten. `away` is `null` while
the mock room has full screen, no hidden tab and a started-or-absent share (`shareLost` is only true if a share had run), so no
countdown bar appears and the existing assertions (roles, test ids, the single `role=status` slow line which is looked up by
text) are unaffected. The provider adds no DOM. (One thing I did not trace in depth: in the mock room `away` can open if the
test's `fullscreenElement` assignment is observed late; the countdown bar would then be an extra `role="status"` element, but no
existing LiveView test queries `role=status` without a text filter, so this cannot break them.)

## Concerns

- None blocking. The countdown writes `document.title` while an episode is open (that is Task 6's hook, unchanged); it restores
  the original title on cleanup.
- Task 8 (editor wiring) can now import `useProctorActions` from `proctor/ProctorContext` and call `foreignPaste` from the
  editor's `onForeign` dependency.
