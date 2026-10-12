# Live interviewer: paste, auto-typer and return-time integrity (design)

Status: draft for review, 2026-10-12. Extends `2026-10-08-live-interviewer-design.md` §7 (proctoring) and
`2026-10-09-live-activity-awareness-design.md` (capture). Decisions in §2 are the user's; everything else is proposed.
All candidate-facing and interviewer-facing wording here is a product-IP draft for the user's review.

## 1. Purpose

Three ways to get an answer you didn't write, all still open:

1. **Paste.** Search during one of the two allowed violations, copy the answer, come back and paste it into the editor.
2. **Auto-typer.** A script (or an OS-level tool) types a prepared answer into the editor at a steady pace.
3. **Time away.** A tab switch counts once however long it lasts, so each of the two free violations can be spent
   searching for minutes.

**Outcomes**
- Text that did not come from inside the room can never land in the editor, and trying ends the round.
- Code that was entered by a script instead of typed is noticed by the interviewer, said plainly, and ends the round.
- Leaving the screen has a return deadline; staying past it costs a further violation, and far past it ends the round.
- A candidate who plays fair is never told they cheated: every rule is disclosed before the round, a visible countdown
  runs wherever the browser allows, and every ending is explainable afterwards.

**Not in scope:** a second device (typing an answer read from a phone), webcam or gaze analysis, board (Excalidraw)
paste, OS-level clipboard managers, scoring from behaviour. A scripted typer with randomised human-like delays and
injected typos can evade §6; this is deterrence plus evidence, with the interviewer's own questions as the backstop.

## 2. Decisions (approved by the user, 2026-10-12)

1. **Foreign paste ends the round at once** as `ended_by_interviewer`. It is *not* part of the two-allowed-violations
   budget. The pasted text is blocked and never inserted.
2. **Local clipboard.** Copy and paste work only inside the room.
3. **Auto-typer ends the round** when confirmed; a single strong signal only makes the interviewer ask the candidate to
   explain their code (§6.3).
4. **Return deadline overstay = one extra full violation, then a hard cap that ends the round** (§7).
5. **Dev mode allows copy and paste** (§4). Production always enforces.
6. This reverses one clause of the activity spec (§1 "keystroke dynamics" out of scope, "clipboard never captured").
   The rest of its promise stands: no raw keystroke stream and no typed or pasted text is ever persisted (§6.1, §10).

## 3. What exists today (the gap)

| Surface | Today | Gap |
|---|---|---|
| Editor | Plain Monaco defaults (`CodeEditor.tsx`): autocomplete, snippets, drag-drop and paste all work | No clipboard handling at all |
| Edit events | `activity.batch` `edit` events carry the inserted text (≤ 200) | Not tagged by how it arrived (typed, pasted, dropped) |
| Typing | No cadence capture | Nothing distinguishes a person from a script |
| Violations | `proctor.event` ledger, weights 1 / 0.5; full violation 1 mentioned, 2 final warning, 3 ends (`proctor_end_at = 3`) | A violation has no duration: 5 s and 5 min cost the same |
| Absence | Browser disconnect ≥ 20 s counts as a violation; 2 min ends `technical` | Does not cover a connected candidate who is on another tab |

## 4. Dev mode

`clipboardRulesActive()` in the web app: `process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_ENFORCE_CLIPBOARD === '1'`
(the same convention as `isMockMode()`; `NODE_ENV` is fixed at build time, so a production build cannot be switched off
at runtime).

- **Inactive (dev):** native copy and paste work. No local clipboard, no marker, no clipboard overwrite at Join, nothing
  blocked and no `foreign_paste` sent.
- **Still on in dev:** the typing capture and checks (§6) and the return clock (§7), so they can be exercised.
- `NEXT_PUBLIC_ENFORCE_CLIPBOARD=1` turns the rules on in dev to test them.

## 5. Overview

```
 browser (candidate)                                          worker (interviewer)
 ┌───────────────────────────────────────┐                  ┌─────────────────────────────────────┐
 │ localClipboard + pasteGuard           │ proctor.event    │ Conductor                           │
 │   foreign paste/drop ───────────────────────────────────▶│   on_proctor (ladder, unchanged)    │
 │ edit provenance (via)                 │ activity.batch   │   on_integrity ─▶ orders, end       │
 │ cadence aggregator (5 s windows) ───────────────────────▶│ integrity.assess_typing (pure)      │
 │ awayEpisode (first signal → all back) │ typing.window    │ AwayWatch (worker clock, timers)    │
 │   ─────────────────────────────────────────────────────▶│                                     │
 └───────────────────────────────────────┘ proctor.away/back└─────────────────────────────────────┘
```

The browser captures facts; the worker decides, times and ends. A tampered browser can drop messages but cannot make the
worker believe a candidate is back.

## 6. Paste and typing (browser capture, worker decision)

### 6.1 Local clipboard and paste guard (browser)

Files: `features/interview-live/proctor/localClipboard.ts` (the buffer), `pasteGuard.ts` (editor wiring).

- **Buffer.** A module-level string for the room and a fixed marker, `IQ-ROOM-CLIPBOARD`. The marker has no nonce on
  purpose: a page refresh loses the buffer but leaves the marker on the OS clipboard, and that must read as "nothing to
  paste", never as a foreign paste.
- **Copy / cut** in the editor or the problem panel: the selected text goes into the buffer; the OS clipboard receives
  only the marker. Nothing useful leaves the room. A cut still removes the selection.
- **Paste** in the editor is always intercepted (keyboard, context menu, drag-drop):
  - OS clipboard text equals the marker and the buffer is non-empty: the buffer is inserted by the editor itself
    (`executeEdits`, source `local-paste`).
  - Whitespace-only or empty OS clipboard with an empty buffer: ignored silently.
  - Anything else is **foreign**: nothing is inserted; the browser sends `proctor.event` kind `foreign_paste`
    (`chars`, `lines`, `clipboard_cleared`; never the text).
- **Clipboard cleared at Join.** The Join click (the same gesture that already calls `enterFullscreen()`) overwrites the
  OS clipboard with the marker, so only text copied during the round can be foreign. If the write is refused,
  `clipboard_cleared` is `false` and the worker treats that round's foreign paste as a full violation instead of ending
  (stale content cannot be told from new). The checks page says the clipboard is cleared.
- **Editor options.** Drag-drop into the editor and "paste as" are disabled; autocomplete, snippet and word-based
  suggestions are off. No editor feature inserts text the candidate did not type.
- **Provenance.** Each `edit` activity event gains `via: typed | local_paste | interviewer | undo | other`.
  Auto-closed brackets, auto-indent, undo/redo, the starter-text swap and the interviewer's edits are never "typed
  characters". A single change of **30 or more characters** with `via: other` and no DOM paste or drop event is an
  **unattributed insert** (extension injection, OS dictation, IME). It does not end the round; it feeds §6.3 as the
  "characters without keys" signal.
- **Candidate sees (round ending):** the interviewer says why (§8) and ends. No header counter: the round ends.

### 6.2 Typing cadence capture (browser)

`proctor/cadence.ts`: `keydown`/`keyup` listeners on the editor. **No key identity leaves the browser**, only classes
(character, backspace/delete, navigation, other). Every 5 s of typing it sends one `typing.window`:

| Field | Meaning |
|---|---|
| `t0`, `t1` | window bounds (browser epoch ms) |
| `keys`, `chars` | character keys pressed; characters inserted into the model by typing |
| `iki` | `{ median, cv }` of the gap between character keys, ms |
| `dwell` | `{ median, cv }` of key hold time, ms |
| `backspaces`, `nav` | correction and navigation key counts |
| `longest_pause` | longest gap in the window, ms |
| `jumps` | edits landing on a line other than the last-edited or last line |
| `untrusted` | key events with `isTrusted === false` |
| `charless` | characters inserted with no key in the same 100 ms (excluding local paste, interviewer, undo, starter swap) |

About 200 bytes, at most one message per 5 s, only while the machine state is `live` or `reconnecting`. Nothing is sent
for a window with no keys, no synthetic keys and no unattributed insert (injected text with no keys at all is exactly
the `no_keys` signal, so it is sent). `iki` and `dwell` are present only with 5 or more samples. `charless` counts the
characters of unattributed inserts (30 or more in one change). Raw timings are not retained anywhere.

### 6.3 Assessment (worker)

`apps/ai-service/app/interviewer/integrity.py`: a pure `assess_typing(windows, now) -> Finding | None`. The worker keeps
the last 10 minutes of windows in memory only; the assessor looks at the trailing 60 s and the round so far.
Thresholds live in `Rules` (first cut, tuned in §12 phase 2 before the end rule is trusted):

| Class | Signal | Condition |
|---|---|---|
| **Decisive** (alone confirms) | `synthetic_keys` | `untrusted > 0` (an in-browser script) |
| | `superhuman_speed` | median gap < 45 ms over ≥ 150 characters (> ~300 WPM) |
| **Strong** (two *different* confirm) | `metronome` | gap `cv` and hold `cv` both < 0.25 over ≥ 80 characters (humans ≈ 0.5 or more) |
| | `no_texture` | ≥ 250 characters, 0 backspaces, no pause ≥ 1.5 s, no jump to an earlier line |
| | `no_keys` | ≥ 40 characters inserted with no key events (`charless`) |
| | `fast` | median gap < 70 ms sustained over ≥ 150 characters |

- **Confirmed** (one decisive, or two different strong): kind `typing_automation`, the round ends.
- **Suspected** (one strong alone): kind `typing_suspected`, no end; the interviewer is ordered to ask the candidate to
  walk through the last block they wrote, and the finding goes to the debrief (§9).
- A finding records the signal names that fired and the window bounds, never characters.

## 7. The return clock

### 7.1 Episodes (browser)

`proctor/awayEpisode.ts`: an episode **starts at the first away signal** (tab hidden, window blur, full-screen exit,
share stopped) and **ends when everything is back** (visible, focused, full screen, sharing). A second display opens no
episode: it cannot be "restored", so a timer on it would end the round at the cap; it stays a one-off violation.
The browser sends `proctor.away { kinds, at }` immediately (not after the 1.5 s merge), where `kinds` is the set of
signals active now, and again whenever that set changes during the episode; `proctor.back { at }` on return. The
existing weighted `proctor.event` ledger and its toast are unchanged.

### 7.2 Timers (worker)

`AwayWatch` in the conductor runs on the worker's own clock from when it receives each message; any duration the client
reports is ignored. Limits are in `Rules`:

| Case | `away_limit_s` |
|---|---|
| Tab hidden, window blur | 15 |
| Full-screen exit, share stopped | 30 |
| Hard cap, any episode | 60 |

The limit follows the strictest signal active in the episode (any of `kinds` in the first row means 15). At the limit: one more full violation `away_overstay`, once
per episode, through the existing ladder (so it can be the 2nd, or the 3rd that ends the round). At the cap: the round
ends as `ended_by_interviewer`. A 16 s tab switch therefore counts two of the three full violations; this is intended
and is why the limits are disclosed (§11) and counted down (§7.3).

A dropped connection is not an episode: the existing absence rules (20 s counts as a violation, 2 min ends `technical`)
apply. If the browser never sends `proctor.back` while still connected, the cap ends the round.

### 7.3 What the candidate sees

- While the tab is visible but out of full screen or unfocused, the proctor bar shows a countdown ("Return within 12 s").
- While hidden, `document.title` shows "⚠ Return in 12 s".
- On return, a toast: "You were away 22 s. That counted as an extra violation." (only when it did).

## 8. Interviewer response

The conductor gains `on_integrity(kind, detail)`; the ladder in `on_proctor` stays as it is. An ending already decided
is never replaced by a milder one (existing `_end_reason`).

| Kind | Source | Effect | Order text (draft) |
|---|---|---|---|
| `foreign_paste` | browser | `_end("ended_by_interviewer")` (full violation instead when `clipboard_cleared` is false) | "The candidate pasted text that did not come from this editor. Say plainly that this is not allowed in this interview and that you are ending it. Be firm, not insulting." |
| `typing_automation` | worker | `_end("ended_by_interviewer")` | "The code was entered by a script, not typed by a person. Say that plainly and end the interview. Never describe how you noticed." |
| `typing_suspected` | worker | order `probe_authorship`, not counted | "Ask them to walk you through the last block of code they wrote, line by line. Do not accuse them." |
| `away_overstay` | worker | full violation through the ladder | "The candidate was away for N seconds, past the limit. Mention it and ask them to stay on this screen." (final warning / ending texts as for any full violation) |
| away cap | worker | `_end("ended_by_interviewer")` | "The candidate was away for over a minute. Say that you are ending the interview because of it." |

The director's snapshot already carries the proctor ledger, so these findings reach it with no change to the brief
schema.

## 9. Protocol and storage

**Web ↔ worker.** New: `proctor.away { kinds, at }`, `proctor.back { at }`, `typing.window`. Extended: `proctor.event` kind `foreign_paste`
(plus optional `chars`, `lines`, `clipboard_cleared`); `activity.batch` `edit` gains `via`. Worker-generated ledger
kinds: `away_overstay`, `typing_automation`, `typing_suspected`. Zod in `messages.ts`, Pydantic mirror in `protocol.py`,
shared examples in `packages/contracts/live-workspace.examples.json`. An older worker ignores unknown messages and
rejects the unknown `proctor.event` kind (`parse_web` returns `None`), so the browser can ship first: the paste is still
blocked, it just does not end the round until the worker is updated.

**Storage.**
- `live_summary` (API Zod default 0 + the `LiveSummary` type): `foreign_pastes`, `away_overstays`, `max_away_s`,
  `typing_flags`. Additive; no migration beyond the jsonb shape.
- `live_runs` ledger: each finding with kind, time, and for typing the signal names and window bounds.
- No pasted text, no typed characters, no raw timings, no pointer or key stream. Account purge already covers `live_runs`.
- End reason stays `ended_by_interviewer`; the finding kind is the "why", so a candidate or admin can always ask why a
  round ended and get a traceable answer (explainability rule).

## 10. Failure modes

| Failure | Behaviour |
|---|---|
| Clipboard write refused at Join | `clipboard_cleared:false`; a foreign paste is a full violation, not an ending |
| Browser can't send (disconnected) | No cadence or away messages; the existing absence rules apply |
| Malformed or oversized message | Dropped whole; the worker logs a count, never content |
| Older worker | Ignores the new messages; paste is still blocked in the browser |
| Monaco intercept behaves differently in a browser | Paste is still cancelled at the DOM `paste` event; the plan phase verifies copy, cut, drop and the context menu per browser |
| `assess_typing` throws | Logged; no finding; the round continues |
| Throttled background timers | Not relied on: the worker times the episode |
| Dev mode | Clipboard rules off (§4); everything else on |

## 11. Disclosure on the instruction page (`PrejoinView.tsx`)

Rules added beside the existing ones, and the same facts in the agreement checkbox (draft):
- "Copy and paste work only inside the room. Text from anywhere else is blocked, and pasting it ends the interview."
- "Your clipboard is cleared when you join."
- "Code must be typed by you. Automated typing ends the interview."
- "If you leave this screen or full screen, return within 15 seconds (30 for full screen or screen share). Past that it
  counts as another violation, and after 60 seconds the interview ends."

## 12. Tests, verification and build phases

**Tests** (written with each phase; run only when the user asks, per their standing rule):
- **Web:** local clipboard (copy, cut, paste, marker, empty, foreign); the paste guard against a fake editor; provenance
  tagging; the cadence aggregator (windowing, classes only, exclusions); `awayEpisode` and `useProctor` (start, end,
  merged signals); the Join clipboard clear and its refusal path; dev-mode gating.
- **Worker:** `assess_typing` over synthetic human traces (lognormal gaps, corrections, pauses) and robot traces (fixed,
  jittered, fast, injected) for every signal and the confirm/suspect rule; `AwayWatch` on a fake clock (limits, cap,
  one overstay per episode, back before the limit, no `back`); conductor ladders and end orders; protocol round-trips
  against the shared examples.
- **Simulator:** `simulate.py` gains `#paste`, `#autotype` and `#away <seconds>`.
- **Mock mode:** the scripted room shows a foreign paste, an auto-typer and an away episode.
- **Real browser (the user):** the allowlisted account, in a production-mode build: copy, cut, paste, context-menu paste,
  drag-drop, and a real auto-typer; plus the user's own typing through `assess_typing` to tune the thresholds.

**Build phases** (one plan each):
1. **Web and protocol:** local clipboard, paste guard, editor options, provenance, cadence capture, away episodes, the
   countdown UI, dev-mode gating, the Join clipboard clear, instruction copy, the shared schema, the Pydantic mirror of
   the three new message types, and a worker guard that ignores them. The Python side accepts `foreign_paste` only in
   phase 2, so until then an updated worker treats it as an unknown kind and ignores it (the paste is still blocked in
   the browser). Ships first.
2. **Worker:** `integrity.py`, `AwayWatch`, `on_integrity`, orders and prompts, summary fields, simulator commands, and
   threshold calibration against real typing. Blocked until no blueprint prep run is in flight and no other agent is
   editing the AI service.
3. **API:** `LiveSummary` fields and Zod defaults.

## 13. Deferred and open

- Exact Monaco interception mechanics (capture-phase DOM events versus Monaco's own copy/cut commands) and the Monaco
  version's `dropIntoEditor` and `pasteAs` options: decided by a small probe in the phase 1 plan.
- Threshold values in §6.3 and §7.2 are first cuts; the end rule for auto-typers is trusted only after calibration (§12).
- Board (Excalidraw) paste in system-design rounds, a second device, and an OS-level typer with randomised delays are
  known gaps (§1).
