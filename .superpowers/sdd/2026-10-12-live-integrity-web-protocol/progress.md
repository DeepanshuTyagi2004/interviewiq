# SDD ledger — plan: docs/superpowers/plans/2026-10-12-live-integrity-web-protocol.md
Spec: docs/superpowers/specs/2026-10-12-live-integrity-design.md
Workspace: .superpowers/sdd/2026-10-12-live-integrity-web-protocol   Helper: .superpowers/sdd/2026-10-12-live-integrity-web-protocol/pkg.sh OUT FILE... (file-scoped working-tree diff vs HEAD)
BASE (HEAD at start): 3e4a6cd730afd7b730f45eec22ede88b7c8ac660  — branch main, NO commits will be made (user's standing rule: no-auto-commit)
Baseline git status before Task 1 (not ours, leave alone): M apps/ai-service/{.env.example,app/config.py,app/interviewer/worker.py,package.json}; ?? .opencode/, apps/ai-service/app/interviewer/lifecycle.py, apps/ai-service/tests/interviewer/test_lifecycle.py; our docs: ?? plan + spec
Dev stack running at start (ps): turbo -> next dev, uvicorn --reload (ai-service), interviewer worker dev. omnirush: not running.

## Rulings
Ruling: no worktree, no commits, work in the main working tree on main — user's standing rule (memory: no-auto-commit; they review and commit themselves), which outranks the skill's worktree/commit steps — cost if wrong: review diffs are file-scoped against HEAD instead of commit ranges; nothing lands in git until the user commits.
Ruling: implementers and reviewers write tests but do NOT run vitest/pytest/tsc/eslint — user's standing rule (memory: no-unrequested-tests, 2026-10-02: "dont run the test unless explicitly stated by me"); the plan's own steps say "when the user has said to run tests"; reports say tests were not run — cost if wrong: transcription/type errors surface only when the user runs the commands; reviewers read for them instead. 'pnpm generate:live-schema' (a generator, not a test) IS run in Task 1.
Ruling: Task 1 Python steps (8-12: protocol.py mirror, run.py guard, their tests) are deferred, no apps/ai-service edits this run — memory rule "never edit ai-service .py while prep runs are in flight (uvicorn --reload orphans them)" and the stack IS running (uvicorn --reload + interviewer worker dev, which reloads a live round); examples.json is read only by tests, so the browser still ships safely (an unmirrored worker drops unknown messages) — cost if wrong: Python test_examples_cover_exactly_the_protocol fails (when run) until the mirror lands; the user must stop the stack or say go, then run Task 1 steps 8-12 (or Phase 2 does it).
Ruling: Task 10 (real-browser checklist) is the user's, not dispatched — plan says the user runs it.

## Pre-flight scan (plan conflicts)
Pairs sharing a file or interface (produces -> consumes):
| Tasks | Produces / consumes | Found |
|---|---|---|
| T1 -> T4, T5 | `EditVia` type (messages.ts) -> provenance.ts, cadence.ts, codeActivity.ts | names match; T1 exports the type |
| T1 -> T6 | `AwayKind`, `WebMessageBody` with `proctor.away/back` -> awayEpisode.ts, useProctor.ts | match |
| T1 -> T6, T7 | `proctor.event` kind `foreign_paste` + `source/chars/lines/clipboard_cleared` -> useProctor.foreignPaste | match; `ProctorKind` (ledger) deliberately unchanged |
| T1 -> T8 | `typing.window` body -> `deps.send({type:'typing.window', ...window})` | `TypingWindowOut` (T5) fields == Zod `TypingWindow` fields; match |
| T2 -> T3 | copyToRoom, getBuffer, bufferIsWholeLine, judgePaste | all exported by T2 under those names |
| T2 -> T6 / T7 / T8 / T9 | wasCleared / forgetBuffer, clipboardRulesActive / clipboardRulesActive / clearSystemClipboard, wasCleared, resetClipboard | all in T2 (forgetBuffer added to T2 during plan self-review) |
| T3 -> T6, T7, T8 | `ForeignInsert`, `attachRoomCopyGuard`, `attachEditorClipboard`, `ClipboardEditor` | match; T8 `IntegrityEditor extends ClipboardEditor` |
| T4 -> T5 | `UNATTRIBUTED_MIN_CHARS` | exported by provenance.ts |
| T4 -> T8 | `createProvenance({now, interviewerEditing})`, `attachCodeActivity(..., classify)` | T8 passes `guard.classify(change,event)`; signature compatible |
| T5 -> T8 | `createCadence`, `classifyKey`, `KeyDown {cls,at,code,trusted}` | match |
| T6 -> T7 | `AwayEpisode`, `useAwayCountdown`, `ProctorState.away/foreignPaste` | match; LiveView passes `away={proctor.away}` |
| T7 -> T8 | `useProctorActions` | match |
| T1 & T6/T7 | files | no shared file (T1 script.ts/messages; T6 useProctor*; T7 ProctorBars/LiveView) |
| any two tasks | edit the same existing file | none: each modified file belongs to exactly one task, so a file-scoped diff vs HEAD is that task's diff |
Per-task self-consistency:
| Task | Own text vs own tests/files | Found |
|---|---|---|
| T1 | Zod/JSON/schema/script + Python | consistent; Python half deferred by ruling; Step 5 regenerates schema; examples need `via` on edit (included) |
| T2 | module vs tests | consistent (forgetBuffer in code, tests, interfaces) |
| T3 | module vs tests | consistent; whole-line maths checked by hand (last line, mid doc, multi-select) |
| T4 | provenance + codeActivity + batcher vs 3 test files | consistent; untagged edits unchanged so existing tests hold |
| T5 | cadence vs tests | consistent; numbers hand-checked (human window median 150, cv 1.69; missed-release dwell) |
| T6 | awayEpisode/useAwayCountdown/useProctor vs tests | consistent; existing useProctor tests' imports edited at top; second display opens no episode (spec corrected) |
| T7 | ProctorBars/Context/LiveView vs tests | consistent |
| T8 | editorIntegrity/CodeEditor vs tests | consistent; mocked `next/dynamic` means onMount is covered only by editorIntegrity tests (by design) |
| T9 | ChecksView/PrejoinView vs tests | consistent; copy strings match test regexes |
Plan vs rubric: no mandated test-that-asserts-nothing; T3 onCopy/onCut similarity is not verbatim duplication. Plan vs user rules: plan steps already gate test runs and commits ("when the user has said to run tests", "no commit") — consistent with rulings above; skill's template steps (commit, run suite, TDD RED/GREEN evidence) are overridden by rulings.
Scan result: no plan defects; three skill-vs-user-rule rulings recorded above.

Task 1: implementer done (agent aac58d00ae2a62dc3, sonnet); web half only; no commits; tests not run; Python steps 8-12 deferred (ruling above)
Task 1: review clean (reviewer a2b03cab63764f76c): web half spec-compliant; hand-traced all new tests.
Task 1: minor (deferred): ProctorEventKind/AwayKind repeat literals instead of deriving from ProctorKind.options (drift risk)
Task 1: minor (deferred): foreign_paste-only fields (source/chars/lines/clipboard_cleared) are allowed on any proctor.event kind
Task 1: minor (deferred): `kinds` allows duplicates; typing.window does not check t1>=t0 (lenient telemetry)
Task 1: complete (no commits by rule; files: messages.ts, messages.test.ts, script.ts, ScriptedLiveSession.test.ts, live-workspace.examples.json, live-workspace.schema.json; Python half deferred, see Rulings)
Task 2: implementer done (agent a73c1e12f9aedc8f1, haiku)
Task 2: review clean (reviewer a4cab2169518ea8ad): module/tests byte-identical to brief; 13 test groups hand-traced pass; exports match consumers T3/6/7/8/9.
Task 2: minor (deferred): judgePaste ignores blank clipboard regardless of buffer (plan-mandated, safe)
Task 2: minor (deferred): copyToRoom null clipboardData branch untested
Task 2: for FINAL review: copyToRoom/judgePaste are ungated by design; every ATTACH site must check clipboardRulesActive() (T7 LiveView effect, T8 editorIntegrity, T9 clearSystemClipboard self-gates). Reviewer note: Read tool is hook-truncated to line 1 on some files; subagents use Bash cat.
Task 2: complete (no commits; files: proctor/localClipboard.ts, localClipboard.test.ts, apps/web/.env.example)
Task 3: implementer done (agent a85d94b910765f3e6, haiku)
Task 3: review (reviewer ad32cb325fdb025f3): spec compliant (byte-identical to brief), all tests hand-traced pass; 1 Important (plan-mandated), 3 Minor.
Task 3: Ruling: Important finding "dragover sets dropEffect='none', so a real browser never fires `drop` and the foreign-drop report (onForeign source 'drop') is unreachable" is real (HTML DnD: no drop event when the current drag operation is none) and contradicts the spec (§2/§6.1: foreign drop ends the round, same as paste) — fix: dragover keeps preventDefault+stopPropagation but does NOT set dropEffect; drop handler unchanged (already cancels, inserts nothing, reports size only); update the dragover test (drop the dropEffect assertion) — cost if wrong: a drag cursor may show "copy" while the drop is then refused and ends the round; plan text for Task 3 to be patched to match at wrap-up.
Task 3: minor (deferred): last-line copy has no trailing "\n" but is flagged wholeLine, so it pastes inline (Monaco drops pasteOnNewLine when text lacks \n) and a last-line cut leaves an empty line
Task 3: minor (deferred): two empty cursors on one line: copy doubles the line; cut passes overlapping ranges to executeEdits (throws "Overlapping ranges", uncaught, after copyToRoom already cancelled the event) — dedupe by line number in selectedText would fix
Task 3: minor (deferred): guard tests dispose() at end of body (a failed assertion leaves document listeners attached for the file)
Task 3: fix round 1/5 dispatched (resume implementer a85d94b910765f3e6): dragover must not set dropEffect
Task 3: fix round 1/5 (1 addressed, 0 open — dragover dropEffect; re-reviewer aeeae5fa83524fe60 haiku; no new breakage)
Task 3: minor (deferred): dragEvent test helper still builds an unused dropEffect:'copy' fake
Task 3: for FINAL review / wrap-up: patch plan Task 3 text (onDragOver without dropEffect; amended drag test) to match the ruling; T3 module leaves clipboardRulesActive gating to the caller (T8).
Task 3: complete (no commits; files: proctor/editorClipboard.ts, editorClipboard.test.ts; 1 fix round)
Task 4: implementer done (agent a94910d4e1069f6d2, sonnet)
Task 4: review clean (reviewer a753cab372c587af8): matches brief; all tests hand-traced pass; existing codeActivity/batcher tests unaffected; CodeEditor 3-arg call still compiles.
Task 4: minor (deferred): TYPED_MAX_CHARS 16/17 boundary untested
Task 4: minor (deferred): asLocalPaste boolean is not re-entrant (nested call clears flag early); harmless with one paste handler
Task 4: note for T8/final: via 'interviewer' never reaches the activity stream (isApplying returns before classify) — by design
Task 4: complete (no commits; files: activity/provenance.ts, provenance.test.ts, codeActivity.via.test.ts, batcher.via.test.ts, codeActivity.ts, batcher.ts)
Task 5: implementer done (agent a39b259a59cec1029, haiku)
Task 5: review clean (reviewer ae20450f1324d604a): byte-identical to brief; every test hand-traced with real numbers; TypingWindowOut assignable to the Zod typing.window body.
Task 5: minor (deferred): cross-window carry (lastCharAt/lastLine/held keys), createCadence.keyUp wrapper and everyMs untested
Task 5: minor (deferred): unused `trusted` option in the test's type() helper
Task 5: minor (deferred): identifier `window` shadows the global in CadenceDeps.send / emit (rename to `out`)
Task 5: note for worker (Phase 2): `jumps` is noisy (a Backspace joining lines counts); windows with only backspaces/nav/chars/jumps are dropped as quiet
Task 5: complete (no commits; files: proctor/cadence.ts, cadence.test.ts)
Task 6: implementer done (agent a357d666f6d550367, sonnet) DONE_WITH_CONCERNS: possible react-hooks/set-state-in-effect lint errors (repo precedent: eslint-disable-next-line at useExternalDisplay.ts:28, AuthProvider.tsx:102); proctor.away swallowed while reconnecting is by design
Task 6: review (reviewer ad010aa8c36a8a9f5): spec compliant; all new tests + existing useProctor behaviour hand-traced pass; types clean; 1 Important (lint), minors below.
Task 6: Ruling: Important finding "two react-hooks/set-state-in-effect errors expected under eslint-plugin-react-hooks 7.1.1 (useAwayCountdown.ts:15 setNow(Date.now()) and useProctor.ts:122 setAway(null) in the !enabled branch)" is a plan defect the repo's own precedent answers (eslint-disable-next-line react-hooks/set-state-in-effect with a reason, as at useExternalDisplay.ts:28 and AuthProvider.tsx:102) — fix: add one disable comment above each of those two sites, no behaviour change; keep the brief's code otherwise — cost if wrong: `pnpm lint` (not run) might flag another site in the same effect (reviewer says add the same directive at useProctor.ts:140/146 then). Plan Task 6 text to be patched at wrap-up.
Task 6: minor (deferred): safeSend swallows all errors; record's merge-window session.send is unguarded (pre-existing); a proctor.away dropped while reconnecting is never re-sent (worker must tolerate `back` with no open episode)
Task 6: minor (deferred): over-limit toast shares the single toast slot/timer with other toasts; its text promises "counts as an extra violation" before the worker enforces it (Phase 2)
Task 6: minor (deferred): no hook-level test of the 15 s tab-limit toast or of window_blur opening an episode
Task 6: fix round 1/5 dispatched (resume implementer a357d666f6d550367): add the two disable comments
Task 6: fix round 1/5 (1 addressed, 0 open — set-state-in-effect disables; re-reviewer a081f10944a54b1ca haiku; no new breakage; lint itself not run)
Task 6: complete (no commits; files: proctor/awayEpisode.ts, awayEpisode.test.ts, useAwayCountdown.ts, useAwayCountdown.test.tsx, useProctor.ts, useProctor.test.tsx; 1 fix round). Wrap-up: patch plan Task 6 text with the two disable comments.
