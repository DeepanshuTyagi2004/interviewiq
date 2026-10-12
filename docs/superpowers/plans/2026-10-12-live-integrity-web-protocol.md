# Live Integrity, Phase 1: Web and Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The browser blocks text that did not come from inside the room, reports how every edit arrived and how the candidate types, and reports when and for how long they leave the screen, all over a shared protocol the worker will act on in Phase 2.

**Architecture:** Capture only, in the browser. A local clipboard plus capture-phase handlers own copy, cut, paste and drop in the Monaco editor; each edit is tagged by how it arrived; a cadence aggregator sends 5-second timing summaries (never characters); an away-episode tracker sends `proctor.away` / `proctor.back` and drives a countdown. The worker (Phase 2) decides and ends rounds; this phase only adds the Pydantic mirror of the three new messages and a guard that makes the worker ignore them.

**Tech Stack:** TypeScript, React 19, Zod 4, Vitest + Testing Library (jsdom), Monaco via `@monaco-editor/react`, Pydantic (the Python mirror), pytest.

**Spec:** `docs/superpowers/specs/2026-10-12-live-integrity-design.md` (read §4, §6, §7, §9, §11 first). Builds on `2026-10-09-live-activity-awareness-design.md` (the capture channel) and `2026-10-08-live-interviewer-design.md` §7 (the ledger).

## Global Constraints

- **Dev mode:** clipboard rules are active only when `process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_ENFORCE_CLIPBOARD === '1'`. In dev, native copy and paste work: no local clipboard, no marker, no clipboard overwrite at Join, nothing blocked, no `foreign_paste` sent. Typing capture and the return clock stay on in dev.
- **Nothing sensitive leaves the browser:** no pasted text, no typed characters, no key identities. Only lengths, line counts, counts and timing statistics.
- **Marker:** the OS clipboard receives the fixed string `IQ-ROOM-CLIPBOARD` (no nonce; a refresh must read as "nothing to paste", never "foreign").
- **Limits (browser countdown only; the worker enforces in Phase 2):** 15 s for tab hidden or window blur, 30 s for full-screen exit or share stopped, hard cap 60 s. A second display opens no episode.
- **Wire names are snake_case** and the Zod module `protocol/messages.ts` is the source; the Pydantic mirror and `packages/contracts/live-workspace.examples.json` follow it. `v` is `1`.
- **Style:** `features/interview-live/**` uses single quotes and no semicolons; files under `app/**` (ChecksView, PrejoinView) use double quotes and semicolons. Match the file you are in.
- **Copy** in this plan is a product-IP draft for the user's review; keep it where the plan puts it.
- **Standing rules (the user's):** do not run vitest, tsc, eslint or pytest unless the user has said to; the test commands below are listed so they can be run on the user's go-ahead. Do not commit (the user commits); end each task with the files left in the working tree. Check `git status` and file mtimes before editing: another agent edits this repo concurrently. Never edit an ai-service `.py` file while a blueprint prep run is in flight or the interviewer worker is running (Task 1 step 11 is the only Python edit in this phase).

## Review Focus

The inputs the spec implies that no happy-path test would catch, most likely first. Each has a test in the task that owns the code.

1. **Page refresh mid-round.** The buffer is lost but the marker is still on the OS clipboard; Ctrl+V must do nothing, not look foreign. (Task 2: `judgePaste`; Task 3.)
2. **A held key.** Auto-repeat `keydown` events must not count as a superhuman rhythm. (Task 8: the editor's key listener skips `repeat`.)
3. **Keyboards that make characters with Alt or AltGr** (macOS Option, Windows AltGr brackets) must count as typing, while Ctrl/Cmd shortcuts must not. (Task 5.)
4. **Edits that are not the candidate's** (undo, redo, the interviewer's inserts, the starter-text swap, a local paste) must never count as typed characters or as injected text. (Tasks 4, 5 and 8.)
5. **A disconnected session or an unshared screen in dev.** `session.send` can throw while reconnecting; a room that never had a screen share (mock mode) must not open an away episode. (Task 6.)

## File Structure

Web, under `apps/web/features/interview-live/`:

| File | Responsibility |
|---|---|
| `protocol/messages.ts` (modify) | Zod: `ProctorEventKind`, `AwayKind`, `EditVia`, `proctor.away`, `proctor.back`, `typing.window`, `foreign_paste` fields |
| `proctor/localClipboard.ts` (create) | The room buffer, the marker, `judgePaste`, `clipboardRulesActive`, clearing the OS clipboard |
| `proctor/editorClipboard.ts` (create) | Capture-phase copy/cut/paste/drop handlers for the editor; the room-wide copy guard |
| `activity/provenance.ts` (create) | How a change to the code arrived (`typed`, `local_paste`, …) |
| `proctor/cadence.ts` (create) | Key classification and the 5-second typing aggregator |
| `proctor/awayEpisode.ts` (create) | Away signals, episode tracking, limits and countdown maths |
| `proctor/useAwayCountdown.ts` (create) | 1 Hz countdown and the tab-title warning |
| `proctor/ProctorContext.tsx` (create) | Lets the editor report a foreign paste to `useProctor` |
| `work/editorIntegrity.ts` (create) | Composes options, clipboard guard, provenance and cadence for one Monaco editor |
| `activity/codeActivity.ts`, `activity/batcher.ts` (modify) | `via` on edit events; merge only equal `via` |
| `proctor/useProctor.ts`, `proctor/ProctorBars.tsx` (modify) | Away messages, foreign-paste action, countdown bar |
| `work/CodeEditor.tsx`, `app/(app)/interviews/[sessionId]/live/_components/{LiveView,ChecksView,PrejoinView}.tsx` (modify) | Wiring, clipboard clear at Join, instruction copy |
| `session/script.ts` (modify) | The mock interviewer ends the round on a foreign paste |

Contracts and worker: `packages/contracts/live-workspace.examples.json`, `live-workspace.schema.json` (generated), `apps/ai-service/app/interviewer/protocol.py`, `run.py`, `tests/interviewer/test_protocol.py`, `test_run.py`.

Commands: from `apps/web` run `pnpm exec vitest run <path>` and `pnpm generate:live-schema`; from `apps/ai-service` run `.venv/bin/python -m pytest <path> -q`.

---

### Task 1: The shared protocol

**Files:**
- Modify: `apps/web/features/interview-live/protocol/messages.ts`
- Modify: `apps/web/features/interview-live/protocol/messages.test.ts`
- Modify: `packages/contracts/live-workspace.examples.json`
- Regenerate: `packages/contracts/live-workspace.schema.json`
- Modify: `apps/web/features/interview-live/session/script.ts`, `session/ScriptedLiveSession.test.ts`
- Modify: `apps/ai-service/app/interviewer/protocol.py`, `run.py`
- Test: `apps/ai-service/tests/interviewer/test_protocol.py`, `test_run.py`

**Interfaces:**
- Produces (Zod, exported from `messages.ts`): `ProctorEventKind`, `AwayKind`, `EditVia` (enums, with `z.infer` types of the same names); messages `ProctorAway { kinds: AwayKind[], at }`, `ProctorBack { at }`, `TypingWindow { t0, t1, keys, chars, iki?, dwell?, backspaces, nav, longest_pause, jumps, untrusted, charless }`; `ProctorEventMessage` gains optional `source: 'paste'|'drop'`, `chars`, `lines`, `clipboard_cleared`; the `edit` activity event gains optional `via: EditVia`. `ProctorKind` (the five ledger kinds) is unchanged, so the ledger tables stay as they are.
- Python (`protocol.py`): models `ProctorAway`, `ProctorBack`, `TypingWindow` in `_WEB_MODELS`. `proctor.event`'s Python `ProctorKind` is **not** extended: Phase 2 does that, so until then an updated worker ignores a `foreign_paste` event.

- [ ] **Step 1: Write the failing protocol tests**

Append inside the `describe('workspace protocol', …)` block of `messages.test.ts` (before its closing `})`):

```ts
  it('accepts a foreign-paste proctor event and rejects unknown kinds and negative sizes', () => {
    const base = examples['proctor.event'] as Record<string, unknown>
    const paste = { ...base, kind: 'foreign_paste', source: 'paste', chars: 120, lines: 6, clipboard_cleared: true }
    expect(WebMessage.safeParse(paste).success).toBe(true)
    expect(WebMessage.safeParse({ ...paste, source: 'drop' }).success).toBe(true)
    expect(WebMessage.safeParse({ ...paste, source: 'clipboard' }).success).toBe(false)
    expect(WebMessage.safeParse({ ...paste, chars: -1 }).success).toBe(false)
    expect(WebMessage.safeParse({ ...base, kind: 'teleport' }).success).toBe(false)
  })

  it('accepts an away set and rejects an empty one or a signal that cannot be undone', () => {
    const away = examples['proctor.away'] as Record<string, unknown>
    expect(WebMessage.safeParse(away).success).toBe(true)
    expect(WebMessage.safeParse({ ...away, kinds: [] }).success).toBe(false)
    expect(WebMessage.safeParse({ ...away, kinds: ['external_display'] }).success).toBe(false)
    expect(WebMessage.safeParse(examples['proctor.back']).success).toBe(true)
  })

  it('accepts a typing window with or without timing statistics and rejects bad counts', () => {
    const ok = examples['typing.window'] as Record<string, unknown>
    expect(WebMessage.safeParse(ok).success).toBe(true)
    const bare = { ...ok }
    delete bare.iki
    delete bare.dwell
    expect(WebMessage.safeParse(bare).success).toBe(true)
    expect(WebMessage.safeParse({ ...ok, keys: -1 }).success).toBe(false)
    expect(WebMessage.safeParse({ ...ok, untrusted: 1.5 }).success).toBe(false)
    expect(WebMessage.safeParse({ ...ok, iki: { median: 100 } }).success).toBe(false)
  })

  it('tags an edit with how it arrived', () => {
    const batch = examples['activity.batch'] as { events: Record<string, unknown>[] }
    const edit = batch.events.find((e) => e.k === 'edit')!
    expect(edit.via).toBe('typed')
    const withVia = (via: unknown) => WebMessage.safeParse({ ...batch, events: [{ ...edit, via }] }).success
    expect(withVia('local_paste')).toBe(true)
    expect(withVia('magic')).toBe(false)
  })
```

Append a new describe to `session/ScriptedLiveSession.test.ts` (end of file):

```ts
describe('ScriptedLiveSession integrity', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('ends the round at once, saying why, after a foreign paste', () => {
    const session = new ScriptedLiveSession({ speed: 1 })
    const endings: Extract<AgentMessage, { type: 'session.ending' }>[] = []
    session.onMessage((m) => { if (m.type === 'session.ending') endings.push(m) })
    session.send({
      type: 'proctor.event', kind: 'foreign_paste', weight: 1, at: 1,
      counts: { tab_changes: 0, screen_changes: 0, full_violations: 0 },
      source: 'paste', chars: 80, lines: 4, clipboard_cleared: true,
    })
    vi.advanceTimersByTime(2000)
    expect(endings).toHaveLength(1)
    expect(endings[0]).toMatchObject({ reason: 'ended_by_interviewer' })
    expect(endings[0].message).toMatch(/pasted/i)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail** (only when the user has said to run tests)

Run (from `apps/web`): `pnpm exec vitest run features/interview-live/protocol/messages.test.ts features/interview-live/session/ScriptedLiveSession.test.ts`
Expected: FAIL (`examples['proctor.away']` is undefined, `foreign_paste` is not a kind).

- [ ] **Step 3: Extend the Zod module**

In `messages.ts`, replace the `ProctorKind` line:

```ts
export const ProctorKind = z.enum(['tab_hidden', 'window_blur', 'external_display', 'fullscreen_exit', 'share_stopped'])
```

with:

```ts
export const ProctorKind = z.enum(['tab_hidden', 'window_blur', 'external_display', 'fullscreen_exit', 'share_stopped'])
/** What a `proctor.event` can report: the five ledger kinds, plus text pasted or dropped in from outside the room
 * (live integrity spec §6.1). The ledger itself only knows `ProctorKind`. */
export const ProctorEventKind = z.enum(['tab_hidden', 'window_blur', 'external_display', 'fullscreen_exit', 'share_stopped', 'foreign_paste'])
/** The signals that put a candidate "away" and that coming back undoes. A second display is not one (spec §7.1). */
export const AwayKind = z.enum(['tab_hidden', 'window_blur', 'fullscreen_exit', 'share_stopped'])
/** How a change to the code arrived (spec §6.1). */
export const EditVia = z.enum(['typed', 'local_paste', 'interviewer', 'undo', 'other'])
```

Replace the `ProctorEventMessage` definition with:

```ts
export const ProctorEventMessage = z.object({
  ...header, type: z.literal('proctor.event'), kind: ProctorEventKind, weight: z.union([z.literal(1), z.literal(0.5)]),
  at: z.number().int().min(0),
  counts: z.object({ tab_changes: z.number().int().min(0), screen_changes: z.number().min(0), full_violations: z.number().int().min(0) }),
  /** `foreign_paste` only: how it arrived, its size (never its text), and whether the clipboard was cleared at Join. */
  source: z.enum(['paste', 'drop']).optional(),
  chars: z.number().int().min(0).optional(),
  lines: z.number().int().min(0).optional(),
  clipboard_cleared: z.boolean().optional(),
})
```

Directly after `export const EndRequest = …` add:

```ts
/** The candidate is away: `kinds` is every away signal active now, sent at the start and whenever the set changes. */
export const ProctorAway = z.object({
  ...header, type: z.literal('proctor.away'), kinds: z.array(AwayKind).min(1).max(4), at: z.number().int().min(0),
})
/** Everything is back: visible, focused, full screen, sharing. */
export const ProctorBack = z.object({ ...header, type: z.literal('proctor.back'), at: z.number().int().min(0) })
```

In the activity section, change the `Edit` constant to:

```ts
const Edit = z.object({
  k: z.literal('edit'), t: At, from_line: Line, to_line: Line, ins: z.string().max(200), removed: z.number().int().min(0),
  via: EditVia.optional(),
})
```

After the `ActivityBatch` definition add:

```ts
const Stat = z.object({ median: z.number().min(0), cv: z.number().min(0) })
const Count = z.number().int().min(0)
/** Typing cadence for one stretch of typing (live integrity spec §6.2): counts and timing statistics, never characters. */
export const TypingWindow = z.object({
  ...header, type: z.literal('typing.window'), t0: At, t1: At, keys: Count, chars: Count,
  iki: Stat.optional(), dwell: Stat.optional(),
  backspaces: Count, nav: Count, longest_pause: z.number().min(0), jumps: Count, untrusted: Count, charless: Count,
})
```

Change the `WebMessage` union to:

```ts
export const WebMessage = z.discriminatedUnion('type', [
  Ack, SectionAdded, HighlightAdded, CodeHighlightAdded, AskSelection, CodeSnapshot, BoardSummary,
  ProctorEventMessage, Hello, EndRequest, ProctorAway, ProctorBack, ActivityBatch, TypingWindow,
])
```

Add to the type exports (next to `export type ProctorKind`):

```ts
export type ProctorEventKind = z.infer<typeof ProctorEventKind>
export type AwayKind = z.infer<typeof AwayKind>
export type EditVia = z.infer<typeof EditVia>
```

- [ ] **Step 4: Add the shared examples**

In `packages/contracts/live-workspace.examples.json`, in the `activity.batch` edit event, add `via` (the `"ins": "for i in range(n):"` line is unique in the file):

```json
        "ins": "for i in range(n):",
        "removed": 0,
        "via": "typed"
      },
```

and replace the end of the file (the last event of `activity.batch` and the closing braces):

```json
      {
        "k": "ptr",
        "t": 1760000000800,
        "s": "out"
      }
    ]
  }
}
```

with:

```json
      {
        "k": "ptr",
        "t": 1760000000800,
        "s": "out"
      }
    ]
  },
  "proctor.away": {
    "v": 1,
    "id": "w_away",
    "type": "proctor.away",
    "kinds": ["tab_hidden", "fullscreen_exit"],
    "at": 1760000002000
  },
  "proctor.back": {
    "v": 1,
    "id": "w_back",
    "type": "proctor.back",
    "at": 1760000012000
  },
  "typing.window": {
    "v": 1,
    "id": "w_typing",
    "type": "typing.window",
    "t0": 1760000000000,
    "t1": 1760000005000,
    "keys": 42,
    "chars": 44,
    "iki": { "median": 118, "cv": 0.71 },
    "dwell": { "median": 92, "cv": 0.38 },
    "backspaces": 3,
    "nav": 1,
    "longest_pause": 2400,
    "jumps": 1,
    "untrusted": 0,
    "charless": 0
  }
}
```

- [ ] **Step 5: Regenerate the committed JSON Schema**

Run (from `apps/web`): `pnpm generate:live-schema`
Expected: `packages/contracts/live-workspace.schema.json` changes (the messages test compares it to the Zod source).

- [ ] **Step 6: Keep the mock interviewer compiling and make it end on a foreign paste**

In `session/script.ts`, replace the `MENTION` constant and the first line of `proctorReply`:

```ts
const MENTION: Record<Exclude<Extract<WebMessage, { type: 'proctor.event' }>['kind'], 'foreign_paste'>, string> = {
  tab_hidden: 'I noticed you switched tabs. Please stay on this screen.',
  window_blur: 'I noticed you moved to another window. Please stay on this screen.',
  external_display: 'I can see a second display. Please disconnect it.',
  fullscreen_exit: "You've left full screen. Please go back to it.",
  share_stopped: 'Your screen share stopped. Please share your entire screen again.',
}

/** Mirrors the spec §7 rule: mention every event; the 2nd full violation gets a final warning; the 3rd ends the round.
 * Text pasted from outside the editor ends the round at once (live integrity spec §2). */
export function proctorReply(event: Extract<WebMessage, { type: 'proctor.event' }>): Step[] {
  if (event.kind === 'foreign_paste') {
    return [
      { after: 400, say: "That text didn't come from this editor, and pasting outside text isn't allowed. I'm ending the interview here." },
      { after: 300, message: { type: 'session.ending', reason: 'ended_by_interviewer', message: "I'm ending the interview here because text was pasted from outside the editor." } },
      { after: 300, disconnect: true },
    ]
  }
  if (event.weight !== 1) return [{ after: 400, say: MENTION[event.kind] }]
```

(the rest of `proctorReply` is unchanged).

- [ ] **Step 7: Run the web tests to verify they pass** (when the user has said to run tests)

Run (from `apps/web`): `pnpm exec vitest run features/interview-live/protocol features/interview-live/session features/interview-live/proctor`
Expected: PASS. The `proctor` tests are included to catch a type or behaviour break in the ledger code.

- [ ] **Step 8: Pre-flight for the Python edit**

Before touching `apps/ai-service`: run `git status --short apps/ai-service` and check the mtimes of `app/interviewer/protocol.py` and `run.py`. If either shows as modified by someone else, or a blueprint prep run is in flight or the interviewer worker is running (`ps aux | grep -E "interviewer|worker.py"`), stop and ask the user. The memory rule is to never edit ai-service `.py` files while prep runs are in flight.

- [ ] **Step 9: Write the failing Python tests**

Append to `apps/ai-service/tests/interviewer/test_protocol.py`:

```python
def test_integrity_messages_parse_and_reject_bad_values():
    away = parse_web(json.dumps(EXAMPLES["proctor.away"]))
    assert away is not None and away.kinds == ["tab_hidden", "fullscreen_exit"] and away.at == 1760000002000
    assert parse_web(json.dumps({**EXAMPLES["proctor.away"], "kinds": []})) is None
    assert parse_web(json.dumps({**EXAMPLES["proctor.away"], "kinds": ["external_display"]})) is None
    back = parse_web(json.dumps(EXAMPLES["proctor.back"]))
    assert back is not None and back.at == 1760000012000
    typing = parse_web(json.dumps(EXAMPLES["typing.window"]))
    assert typing is not None and typing.iki.median == 118 and typing.untrusted == 0 and typing.charless == 0
    bare = {k: v for k, v in EXAMPLES["typing.window"].items() if k not in ("iki", "dwell")}
    parsed_bare = parse_web(json.dumps(bare))
    assert parsed_bare is not None and parsed_bare.iki is None and parsed_bare.dwell is None
    assert parse_web(json.dumps({**EXAMPLES["typing.window"], "keys": -1})) is None
    assert parse_web(json.dumps({**EXAMPLES["typing.window"], "iki": {"median": 100}})) is None


def test_an_unextended_worker_still_rejects_a_foreign_paste_event():
    """Phase 2 teaches the worker this kind; until then it is dropped, never mistaken for a screen switch."""
    paste = {**EXAMPLES["proctor.event"], "kind": "foreign_paste", "source": "paste", "chars": 80, "lines": 3, "clipboard_cleared": True}
    assert parse_web(json.dumps(paste)) is None
```

Append to `apps/ai-service/tests/interviewer/test_run.py`:

```python
def test_the_browser_integrity_messages_are_accepted_and_ignored_until_the_worker_handles_them():
    async def go():
        run, _, _ = make([say("Hello.")])
        await run.start(None)
        woken = []
        run._trigger_director = lambda: woken.append(1)
        for body in (
            {"type": "proctor.away", "kinds": ["tab_hidden"], "at": 1},
            {"type": "proctor.back", "at": 2},
            {"type": "typing.window", "t0": 0, "t1": 5000, "keys": 40, "chars": 40, "backspaces": 0, "nav": 0,
             "longest_pause": 300, "jumps": 0, "untrusted": 0, "charless": 0},
        ):
            msg = web(body)
            assert msg is not None
            await run.on_web_message(msg)
        return run, woken

    run, woken = asyncio.run(go())
    assert woken == []                                   # they never wake the director
    assert run.conductor.full_violations == 0 and run.conductor.proctor == []
    assert run.speaker.replies == 0
```

- [ ] **Step 10: Run the Python tests to verify they fail** (when the user has said to run tests)

Run (from `apps/ai-service`): `.venv/bin/python -m pytest tests/interviewer/test_protocol.py tests/interviewer/test_run.py -q`
Expected: FAIL (`proctor.away` is not a web type; `test_examples_cover_exactly_the_protocol` fails too).

- [ ] **Step 11: Add the Pydantic mirror and the worker guard**

In `protocol.py`, next to `ProctorKind`, add:

```python
AwayKind = Literal["tab_hidden", "window_blur", "fullscreen_exit", "share_stopped"]
```

After `class EndRequest(_Msg): …` and before `class _Event(_M):` add:

```python
class ProctorAway(_Msg):
    type: Literal["proctor.away"]
    kinds: list[AwayKind] = Field(min_length=1, max_length=4)
    at: int = Field(ge=0)


class ProctorBack(_Msg):
    type: Literal["proctor.back"]
    at: int = Field(ge=0)


class TypingStat(_M):
    median: float = Field(ge=0)
    cv: float = Field(ge=0)


class TypingWindow(_Msg):
    type: Literal["typing.window"]
    t0: int = Field(ge=0)
    t1: int = Field(ge=0)
    keys: int = Field(ge=0)
    chars: int = Field(ge=0)
    iki: TypingStat | None = None
    dwell: TypingStat | None = None
    backspaces: int = Field(ge=0)
    nav: int = Field(ge=0)
    longest_pause: float = Field(ge=0)
    jumps: int = Field(ge=0)
    untrusted: int = Field(ge=0)
    charless: int = Field(ge=0)
```

Change `_WEB_MODELS` to:

```python
_WEB_MODELS = (Ack, SectionAdded, HighlightAdded, CodeHighlightAdded, AskSelection, CodeSnapshot, BoardSummary,
               ProctorEventMessage, Hello, EndRequest, ProctorAway, ProctorBack, ActivityBatch, TypingWindow)
```

In `run.py`, add near the other module constants (next to `ABSENCE_VIOLATION_S`):

```python
# Browser integrity messages the worker does not act on yet (live-integrity plan 2). They parse, then are dropped here so
# a typing window every 5 s never wakes the director.
IGNORED_WEB_TYPES = frozenset({"typing.window", "proctor.away", "proctor.back"})
```

and at the very top of `on_web_message`, before the `if not self.begun.is_set():` line:

```python
        if m.type in IGNORED_WEB_TYPES:
            return
```

- [ ] **Step 12: Run the Python tests to verify they pass** (when the user has said to run tests)

Run (from `apps/ai-service`): `.venv/bin/python -m pytest tests/interviewer/test_protocol.py tests/interviewer/test_run.py -q`
Expected: PASS (every parametrised example, including the three new ones).

- [ ] **Step 13: Leave the files in the working tree**

Do not commit. Report the changed files: `messages.ts`, `messages.test.ts`, `script.ts`, `ScriptedLiveSession.test.ts`, `live-workspace.examples.json`, `live-workspace.schema.json`, `protocol.py`, `run.py`, `test_protocol.py`, `test_run.py`.

---
### Task 2: The room clipboard

**Files:**
- Create: `apps/web/features/interview-live/proctor/localClipboard.ts`
- Test: `apps/web/features/interview-live/proctor/localClipboard.test.ts`
- Modify: `apps/web/.env.example`

**Interfaces:**
- Produces: `CLIPBOARD_MARKER: string`; `clipboardRulesActive(): boolean`; `getBuffer(): string`; `bufferIsWholeLine(): boolean`; `wasCleared(): boolean`; `forgetBuffer(): void` (the room's text only; keeps the cleared flag, which the next Join sets again); `resetClipboard(): void` (everything, for tests); `copyToRoom(text: string, event: ClipboardEvent, wholeLine?: boolean): void`; `clearSystemClipboard(): Promise<boolean>` (never rejects); `type PasteVerdict = 'local' | 'ignore' | 'foreign'`; `judgePaste(osText: string): PasteVerdict`.

- [ ] **Step 1: Write the failing tests**

Create `localClipboard.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CLIPBOARD_MARKER, bufferIsWholeLine, clearSystemClipboard, clipboardRulesActive, copyToRoom, forgetBuffer, getBuffer, judgePaste, resetClipboard, wasCleared,
} from './localClipboard'

function copyEvent() {
  const written: Record<string, string> = {}
  const preventDefault = vi.fn()
  const event = { preventDefault, clipboardData: { setData: (type: string, value: string) => { written[type] = value } } } as unknown as ClipboardEvent
  return { event, written, preventDefault }
}

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
}

afterEach(() => {
  resetClipboard()
  vi.unstubAllEnvs()
  Reflect.deleteProperty(navigator, 'clipboard')
})

describe('clipboardRulesActive', () => {
  it('is off in dev and test builds, on in production, and can be forced on', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXT_PUBLIC_ENFORCE_CLIPBOARD', '')
    expect(clipboardRulesActive()).toBe(false)
    vi.stubEnv('NEXT_PUBLIC_ENFORCE_CLIPBOARD', '1')
    expect(clipboardRulesActive()).toBe(true)
    vi.stubEnv('NEXT_PUBLIC_ENFORCE_CLIPBOARD', '0')
    expect(clipboardRulesActive()).toBe(false)
    vi.stubEnv('NODE_ENV', 'production')
    expect(clipboardRulesActive()).toBe(true)
  })
})

describe('copyToRoom', () => {
  it('keeps the text in the room and leaves only the marker on the OS clipboard', () => {
    const { event, written, preventDefault } = copyEvent()
    copyToRoom('x = 1', event)
    expect(preventDefault).toHaveBeenCalled()
    expect(getBuffer()).toBe('x = 1')
    expect(bufferIsWholeLine()).toBe(false)
    expect(written['text/plain']).toBe(CLIPBOARD_MARKER)
  })

  it('remembers that the copy was a whole line', () => {
    copyToRoom('x = 1\n', copyEvent().event, true)
    expect(bufferIsWholeLine()).toBe(true)
  })

  it('cancels an empty copy and keeps what was copied before', () => {
    copyToRoom('first', copyEvent().event)
    const { event, written, preventDefault } = copyEvent()
    copyToRoom('', event)
    expect(preventDefault).toHaveBeenCalled()
    expect(getBuffer()).toBe('first')
    expect(written).toEqual({})
  })
})

describe('judgePaste', () => {
  it('inserts the room buffer when the OS clipboard holds the marker', () => {
    copyToRoom('x = 1', copyEvent().event)
    expect(judgePaste(CLIPBOARD_MARKER)).toBe('local')
  })

  it('does nothing with the marker after a page refresh, when the buffer is gone', () => {
    expect(judgePaste(CLIPBOARD_MARKER)).toBe('ignore')
  })

  it('ignores an empty or blank clipboard', () => {
    copyToRoom('x = 1', copyEvent().event)
    expect(judgePaste('')).toBe('ignore')
    expect(judgePaste(' \n\t')).toBe('ignore')
  })

  it('calls anything else foreign, even when the room has a buffer', () => {
    copyToRoom('x = 1', copyEvent().event)
    expect(judgePaste('def solve(): pass')).toBe('foreign')
    expect(judgePaste(`${CLIPBOARD_MARKER} and more`)).toBe('foreign')
  })
})

describe('clearSystemClipboard', () => {
  it('writes the marker and records that the clipboard was cleared', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const writeText = vi.fn(async () => {})
    stubClipboard(writeText)
    await expect(clearSystemClipboard()).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith(CLIPBOARD_MARKER)
    expect(wasCleared()).toBe(true)
  })

  it('records a refusal instead of throwing', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    stubClipboard(async () => { throw new Error('denied') })
    await expect(clearSystemClipboard()).resolves.toBe(false)
    expect(wasCleared()).toBe(false)
  })

  it('does nothing while the rules are off (dev)', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXT_PUBLIC_ENFORCE_CLIPBOARD', '')
    const writeText = vi.fn(async () => {})
    stubClipboard(writeText)
    await expect(clearSystemClipboard()).resolves.toBe(false)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('is forgotten when the room is reset', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    stubClipboard(async () => {})
    await clearSystemClipboard()
    resetClipboard()
    expect(wasCleared()).toBe(false)
  })
})

describe('forgetBuffer', () => {
  it('drops the room text but keeps the record that the clipboard was cleared at Join', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    stubClipboard(async () => {})
    await clearSystemClipboard()
    copyToRoom('x = 1\n', copyEvent().event, true)
    forgetBuffer()
    expect(getBuffer()).toBe('')
    expect(bufferIsWholeLine()).toBe(false)
    expect(wasCleared()).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail** (when the user has said to run tests)

Run (from `apps/web`): `pnpm exec vitest run features/interview-live/proctor/localClipboard.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the module**

Create `localClipboard.ts`:

```ts
/**
 * The room's own clipboard (live integrity spec §6.1). Copy and cut inside the room keep their text here and leave only a
 * marker on the OS clipboard, so nothing useful leaves the room; a paste inserts the text back. Anything else on the OS
 * clipboard at paste time came from outside the room and is foreign.
 */

/** What the OS clipboard holds after a copy inside the room. Fixed on purpose: a page refresh loses the buffer, not this. */
export const CLIPBOARD_MARKER = 'IQ-ROOM-CLIPBOARD'

/** Dev builds keep native copy and paste (spec §4); production always enforces. `NEXT_PUBLIC_ENFORCE_CLIPBOARD=1`
 * turns the rules on in dev to test them. */
export function clipboardRulesActive(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_ENFORCE_CLIPBOARD === '1'
}

let buffer = ''
let bufferIsLine = false
let cleared = false

export function getBuffer(): string {
  return buffer
}

/** True when the last copy was an empty selection, which takes its whole line (the editor pastes those on a line of their own). */
export function bufferIsWholeLine(): boolean {
  return bufferIsLine
}

/** True once the Join click replaced the OS clipboard with the marker: only text copied during the round can be foreign. */
export function wasCleared(): boolean {
  return cleared
}

/** Forgets the room's text when the room closes. The cleared flag stays: the next Join sets it again either way (and a dev
 * build's double-mounted effects must not lose it). */
export function forgetBuffer(): void {
  buffer = ''
  bufferIsLine = false
}

/** Forgets everything (tests). */
export function resetClipboard(): void {
  forgetBuffer()
  cleared = false
}

/** Keeps a copy or cut in the room and leaves only the marker on the OS clipboard. An empty copy changes nothing. */
export function copyToRoom(text: string, event: ClipboardEvent, wholeLine = false): void {
  event.preventDefault()
  if (text === '') return
  buffer = text
  bufferIsLine = wholeLine
  event.clipboardData?.setData('text/plain', CLIPBOARD_MARKER)
}

/** Replaces whatever is on the OS clipboard with the marker. Needs a user gesture, so call it from the Join click. A
 * refusal is recorded (`wasCleared()` stays false) and never thrown: the worker then treats a foreign paste as a
 * violation rather than an ending, because stale content cannot be told from new. */
export async function clearSystemClipboard(): Promise<boolean> {
  if (!clipboardRulesActive()) return false
  try {
    await navigator.clipboard.writeText(CLIPBOARD_MARKER)
    cleared = true
  } catch {
    cleared = false
  }
  return cleared
}

export type PasteVerdict = 'local' | 'ignore' | 'foreign'

/** What a paste means, given the text the browser says the OS clipboard holds. */
export function judgePaste(osText: string): PasteVerdict {
  if (osText === CLIPBOARD_MARKER) return buffer === '' ? 'ignore' : 'local'
  if (osText.trim() === '') return 'ignore'
  return 'foreign'
}
```

- [ ] **Step 4: Document the dev override**

Append to `apps/web/.env.example`:

```
# Local development only: copy and paste work natively in dev. Set 1 to turn the live room's clipboard rules on (blocked
# foreign pastes, the room clipboard) to test them. Production builds always enforce them.
NEXT_PUBLIC_ENFORCE_CLIPBOARD=0
```

- [ ] **Step 5: Run the tests to verify they pass** (when the user has said to run tests)

Run (from `apps/web`): `pnpm exec vitest run features/interview-live/proctor/localClipboard.test.ts`
Expected: PASS.

- [ ] **Step 6: Leave the files in the working tree** (no commit): `localClipboard.ts`, `localClipboard.test.ts`, `.env.example`.

---

### Task 3: The editor clipboard guard

**Files:**
- Create: `apps/web/features/interview-live/proctor/editorClipboard.ts`
- Test: `apps/web/features/interview-live/proctor/editorClipboard.test.ts`

**Interfaces:**
- Consumes (Task 2): `copyToRoom`, `getBuffer`, `bufferIsWholeLine`, `judgePaste`.
- Produces: `ClipRange`, `ClipSelection`, `ClipboardEditor`, `ForeignInsert { source: 'paste'|'drop'; chars: number; lines: number }`, `EditorClipboardDeps { asLocalPaste(fn: () => void): void; onForeign(info: ForeignInsert): void }`, `selectedText(editor)`, `attachEditorClipboard(host: HTMLElement, editor: ClipboardEditor, deps: EditorClipboardDeps): () => void`, `attachRoomCopyGuard(doc): () => void`.

Known limit (spec §1, board paste is out of scope): copies made on the whiteboard stay native, so pasting one into the editor reads as foreign.

- [ ] **Step 1: Write the failing tests**

Create `editorClipboard.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachEditorClipboard, attachRoomCopyGuard, selectedText, type ClipRange, type ClipSelection, type ClipboardEditor } from './editorClipboard'
import { CLIPBOARD_MARKER, bufferIsWholeLine, getBuffer, resetClipboard } from './localClipboard'

const sel = (sl: number, sc: number, el: number, ec: number): ClipSelection => ({
  startLineNumber: sl, startColumn: sc, endLineNumber: el, endColumn: ec, isEmpty: () => sl === el && sc === ec,
})

function fakeEditor(lines: string[], selections: ClipSelection[]) {
  const valueInRange = (r: ClipRange): string => {
    if (r.startLineNumber === r.endLineNumber) return lines[r.startLineNumber - 1].slice(r.startColumn - 1, r.endColumn - 1)
    const parts = [lines[r.startLineNumber - 1].slice(r.startColumn - 1)]
    for (let n = r.startLineNumber + 1; n < r.endLineNumber; n++) parts.push(lines[n - 1])
    parts.push(lines[r.endLineNumber - 1].slice(0, r.endColumn - 1))
    return parts.join('\n')
  }
  const editor: ClipboardEditor = {
    getSelections: () => selections,
    getModel: () => ({ getValueInRange: valueInRange, getLineMaxColumn: (n: number) => lines[n - 1].length + 1, getLineCount: () => lines.length }),
    executeEdits: vi.fn(() => true),
    pushUndoStop: vi.fn(() => true),
    trigger: vi.fn(),
  }
  return editor
}

function clipEvent(type: 'copy' | 'cut' | 'paste', osText = '') {
  const written: Record<string, string> = {}
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => osText, setData: (t: string, v: string) => { written[t] = v } } })
  return { event, written }
}

function dragEvent(type: 'dragover' | 'drop', text = '') {
  const event = new Event(type, { bubbles: true, cancelable: true })
  const dataTransfer = { getData: () => text, dropEffect: 'copy' }
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  return { event, dataTransfer }
}

function setup(lines: string[], selections: ClipSelection[]) {
  const host = document.createElement('div')
  const inner = document.createElement('textarea')
  host.appendChild(inner)
  document.body.appendChild(host)
  const editor = fakeEditor(lines, selections)
  const deps = { asLocalPaste: vi.fn((fn: () => void) => fn()), onForeign: vi.fn() }
  const dispose = attachEditorClipboard(host, editor, deps)
  return { host, inner, editor, deps, dispose }
}

const CODE = ['def f(x):', '    return x']

afterEach(() => {
  resetClipboard()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('selectedText', () => {
  it('takes the whole line, with its line break, for an empty selection', () => {
    expect(selectedText(fakeEditor(['a = 1', 'b = 2'], [sel(1, 3, 1, 3)]))).toMatchObject({ text: 'a = 1\n', wholeLine: true })
  })

  it('takes the last line without a line break', () => {
    expect(selectedText(fakeEditor(['a = 1', 'b = 2'], [sel(2, 1, 2, 1)]))).toMatchObject({ text: 'b = 2', wholeLine: true })
  })

  it('joins several selections with a line break', () => {
    expect(selectedText(fakeEditor(CODE, [sel(1, 1, 1, 4), sel(2, 5, 2, 11)]))).toMatchObject({ text: 'def\nreturn', wholeLine: false })
  })
})

describe('attachEditorClipboard', () => {
  it('copy keeps the selection in the room, leaves only the marker, and hides the event from the editor', () => {
    const { inner } = setup(CODE, [sel(2, 5, 2, 13)])
    const seen = vi.fn()
    inner.addEventListener('copy', seen)
    const { event, written } = clipEvent('copy')
    inner.dispatchEvent(event)
    expect(getBuffer()).toBe('return x')
    expect(written['text/plain']).toBe(CLIPBOARD_MARKER)
    expect(event.defaultPrevented).toBe(true)
    expect(seen).not.toHaveBeenCalled()
  })

  it('copy with no selection takes the line and pastes it on a line of its own', () => {
    const { inner, editor } = setup(CODE, [sel(1, 4, 1, 4)])
    inner.dispatchEvent(clipEvent('copy').event)
    expect(getBuffer()).toBe('def f(x):\n')
    expect(bufferIsWholeLine()).toBe(true)
    inner.dispatchEvent(clipEvent('paste', CLIPBOARD_MARKER).event)
    expect(editor.trigger).toHaveBeenCalledWith('room-clipboard', 'paste', expect.objectContaining({ text: 'def f(x):\n', pasteOnNewLine: true }))
  })

  it('cut keeps the selection in the room and removes it from the code', () => {
    const { inner, editor } = setup(CODE, [sel(2, 5, 2, 13)])
    const { event } = clipEvent('cut')
    inner.dispatchEvent(event)
    expect(getBuffer()).toBe('return x')
    expect(editor.executeEdits).toHaveBeenCalledWith('room-cut', [{ range: expect.objectContaining({ startLineNumber: 2, startColumn: 5, endColumn: 13 }), text: '' }])
    expect(event.defaultPrevented).toBe(true)
  })

  it('pastes the room buffer when the OS clipboard holds the marker, tagged as a local paste', () => {
    const { inner, editor, deps } = setup(CODE, [sel(2, 5, 2, 13)])
    inner.dispatchEvent(clipEvent('copy').event)
    const { event } = clipEvent('paste', CLIPBOARD_MARKER)
    inner.dispatchEvent(event)
    expect(deps.asLocalPaste).toHaveBeenCalledTimes(1)
    expect(editor.trigger).toHaveBeenCalledWith('room-clipboard', 'paste', expect.objectContaining({ text: 'return x', pasteOnNewLine: false }))
    expect(deps.onForeign).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })

  it('does nothing when the marker is on the clipboard but the buffer is gone (a refresh)', () => {
    const { inner, editor, deps } = setup(CODE, [sel(1, 1, 1, 1)])
    const { event } = clipEvent('paste', CLIPBOARD_MARKER)
    inner.dispatchEvent(event)
    expect(editor.trigger).not.toHaveBeenCalled()
    expect(deps.onForeign).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })

  it('blocks a foreign paste, reports its size but never its text, and inserts nothing', () => {
    const { inner, editor, deps } = setup(CODE, [sel(1, 1, 1, 1)])
    const text = 'def solve(): pass\n    return 1'
    const { event } = clipEvent('paste', text)
    inner.dispatchEvent(event)
    expect(editor.trigger).not.toHaveBeenCalled()
    expect(editor.executeEdits).not.toHaveBeenCalled()
    expect(deps.onForeign).toHaveBeenCalledWith({ source: 'paste', chars: text.length, lines: 2 })
    expect(event.defaultPrevented).toBe(true)
  })

  it('ignores an empty or blank paste', () => {
    const { inner, deps } = setup(CODE, [sel(1, 1, 1, 1)])
    inner.dispatchEvent(clipEvent('paste', '').event)
    inner.dispatchEvent(clipEvent('paste', '  \n ').event)
    expect(deps.onForeign).not.toHaveBeenCalled()
  })

  it('treats dropped text as foreign and refuses the drop', () => {
    const { inner, deps } = setup(CODE, [sel(1, 1, 1, 1)])
    const over = dragEvent('dragover')
    inner.dispatchEvent(over.event)
    expect(over.event.defaultPrevented).toBe(true)
    expect(over.dataTransfer.dropEffect).toBe('none')
    const drop = dragEvent('drop', 'answer = 42')
    inner.dispatchEvent(drop.event)
    expect(drop.event.defaultPrevented).toBe(true)
    expect(deps.onForeign).toHaveBeenCalledWith({ source: 'drop', chars: 11, lines: 1 })
  })

  it('ignores a drop that carries no text (a file)', () => {
    const { inner, deps } = setup(CODE, [sel(1, 1, 1, 1)])
    inner.dispatchEvent(dragEvent('drop', '').event)
    expect(deps.onForeign).not.toHaveBeenCalled()
  })

  it('stops handling events once disposed', () => {
    const { inner, dispose, deps } = setup(CODE, [sel(1, 1, 1, 1)])
    dispose()
    const { event } = clipEvent('paste', 'def solve(): pass')
    inner.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(deps.onForeign).not.toHaveBeenCalled()
  })
})

describe('attachRoomCopyGuard', () => {
  function copyFrom(el: Element) {
    const { event, written } = clipEvent('copy')
    el.dispatchEvent(event)
    return { event, written }
  }

  it('keeps a copy from the problem panel in the room', () => {
    vi.spyOn(document, 'getSelection').mockReturnValue({ toString: () => 'two sum' } as unknown as Selection)
    const dispose = attachRoomCopyGuard(document)
    const p = document.body.appendChild(document.createElement('p'))
    const { event, written } = copyFrom(p)
    expect(getBuffer()).toBe('two sum')
    expect(written['text/plain']).toBe(CLIPBOARD_MARKER)
    expect(event.defaultPrevented).toBe(true)
    dispose()
  })

  it('leaves the editor, text fields and the whiteboard to their own handling', () => {
    vi.spyOn(document, 'getSelection').mockReturnValue({ toString: () => 'selected' } as unknown as Selection)
    const dispose = attachRoomCopyGuard(document)
    for (const html of ['<div class="monaco-editor"><textarea></textarea></div>', '<input />', '<div class="excalidraw"><canvas></canvas></div>']) {
      const wrap = document.body.appendChild(document.createElement('div'))
      wrap.innerHTML = html
      const { event } = copyFrom(wrap.firstElementChild!.firstElementChild ?? wrap.firstElementChild!)
      expect(event.defaultPrevented).toBe(false)
    }
    expect(getBuffer()).toBe('')
    dispose()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail** (when the user has said to run tests)

Run (from `apps/web`): `pnpm exec vitest run features/interview-live/proctor/editorClipboard.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the module**

Create `editorClipboard.ts`:

```ts
/**
 * Owns copy, cut, paste and drop for the editor while the clipboard rules are active (live integrity spec §6.1).
 * Capture-phase listeners on the editor's DOM node cancel the event before Monaco sees it, so nothing but the room's own
 * buffer can reach the code. Typed against the slice of the editor it uses, so tests drive it with a fake.
 */
import { bufferIsWholeLine, copyToRoom, getBuffer, judgePaste } from './localClipboard'

export interface ClipRange {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}
export interface ClipSelection extends ClipRange {
  isEmpty(): boolean
}
export interface ClipboardEditor {
  getSelections(): readonly ClipSelection[] | null
  getModel(): { getValueInRange(range: ClipRange): string; getLineMaxColumn(line: number): number; getLineCount(): number } | null
  executeEdits(source: string, edits: { range: ClipRange; text: string }[]): boolean
  pushUndoStop(): boolean
  trigger(source: string, handlerId: string, payload: unknown): void
}

/** Text that did not come from inside the room: how it arrived and how big it was, never what it said. */
export interface ForeignInsert {
  source: 'paste' | 'drop'
  chars: number
  lines: number
}
export interface EditorClipboardDeps {
  /** Runs `fn` while the editor's changes are the candidate's own local paste, so they are tagged `local_paste`. */
  asLocalPaste(fn: () => void): void
  onForeign(info: ForeignInsert): void
}

const lineCount = (text: string) => text.split(/\r\n|\r|\n/).length

/** What a copy takes: each selection joined by a line break; an empty selection takes its whole line, like the editor does. */
export function selectedText(editor: ClipboardEditor): { text: string; ranges: ClipRange[]; wholeLine: boolean } {
  const model = editor.getModel()
  const selections = editor.getSelections() ?? []
  if (!model || selections.length === 0) return { text: '', ranges: [], wholeLine: false }
  const ranges: ClipRange[] = selections.map((s) => {
    if (!s.isEmpty()) return s
    const line = s.startLineNumber
    return line >= model.getLineCount()
      ? { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: model.getLineMaxColumn(line) }
      : { startLineNumber: line, startColumn: 1, endLineNumber: line + 1, endColumn: 1 }
  })
  return { text: ranges.map((r) => model.getValueInRange(r)).join('\n'), ranges, wholeLine: selections.every((s) => s.isEmpty()) }
}

export function attachEditorClipboard(host: HTMLElement, editor: ClipboardEditor, deps: EditorClipboardDeps): () => void {
  const onCopy = (e: Event) => {
    const event = e as ClipboardEvent
    event.stopPropagation()
    const { text, wholeLine } = selectedText(editor)
    copyToRoom(text, event, wholeLine)
  }
  const onCut = (e: Event) => {
    const event = e as ClipboardEvent
    event.stopPropagation()
    const { text, ranges, wholeLine } = selectedText(editor)
    copyToRoom(text, event, wholeLine)
    if (text === '') return
    editor.pushUndoStop()
    editor.executeEdits('room-cut', ranges.map((range) => ({ range, text: '' })))
    editor.pushUndoStop()
  }
  const onPaste = (e: Event) => {
    const event = e as ClipboardEvent
    event.preventDefault()
    event.stopPropagation()
    const os = event.clipboardData?.getData('text/plain') ?? ''
    const verdict = judgePaste(os)
    if (verdict === 'local') {
      deps.asLocalPaste(() =>
        editor.trigger('room-clipboard', 'paste', { text: getBuffer(), pasteOnNewLine: bufferIsWholeLine(), multicursorText: null, mode: null }),
      )
    } else if (verdict === 'foreign') {
      deps.onForeign({ source: 'paste', chars: os.length, lines: lineCount(os) })
    }
  }
  const onDragOver = (e: Event) => {
    const event = e as DragEvent
    event.preventDefault()
    event.stopPropagation()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
  }
  const onDrop = (e: Event) => {
    const event = e as DragEvent
    event.preventDefault()
    event.stopPropagation()
    const text = event.dataTransfer?.getData('text/plain') ?? ''
    if (text.trim() !== '') deps.onForeign({ source: 'drop', chars: text.length, lines: lineCount(text) })
  }
  const handlers: [string, (e: Event) => void][] = [['copy', onCopy], ['cut', onCut], ['paste', onPaste], ['dragover', onDragOver], ['drop', onDrop]]
  for (const [type, fn] of handlers) host.addEventListener(type, fn, true)
  return () => {
    for (const [type, fn] of handlers) host.removeEventListener(type, fn, true)
  }
}

/** Copy and cut anywhere else in the room (the problem panel, the conversation) also stay in the room. The editor has its
 * own guard, text fields keep native copy, and the whiteboard keeps its own clipboard (a known limit, spec §1). */
export function attachRoomCopyGuard(doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'getSelection'>): () => void {
  const onCopy = (e: Event) => {
    const target = e.target
    if (target instanceof Element && target.closest('.monaco-editor, .excalidraw, input, textarea, [contenteditable="true"]')) return
    copyToRoom(doc.getSelection()?.toString() ?? '', e as ClipboardEvent)
  }
  doc.addEventListener('copy', onCopy, true)
  doc.addEventListener('cut', onCopy, true)
  return () => {
    doc.removeEventListener('copy', onCopy, true)
    doc.removeEventListener('cut', onCopy, true)
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass** (when the user has said to run tests)

Run (from `apps/web`): `pnpm exec vitest run features/interview-live/proctor/editorClipboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Leave the files in the working tree** (no commit): `editorClipboard.ts`, `editorClipboard.test.ts`.

---
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

### Task 5: Typing cadence

**Files:**
- Create: `apps/web/features/interview-live/proctor/cadence.ts`
- Test: `apps/web/features/interview-live/proctor/cadence.test.ts`

**Interfaces:**
- Consumes (Task 4): `UNATTRIBUTED_MIN_CHARS`; (Task 1) the `EditVia` type.
- Produces: `WINDOW_MS = 5000`, `MAX_RHYTHM_GAP_MS = 10000`, `MIN_SAMPLES = 5`; `type KeyClass = 'char' | 'backspace' | 'nav' | 'other'`; `classifyKey(e): KeyClass`; `interface KeyDown { cls: KeyClass; at: number; code: string; trusted: boolean }`; `interface TypingWindowOut` (the `typing.window` body without `type`); `class CadenceAggregator { keyDown(k), keyUp(code, at), inserted(chars, via, line), flush(now): TypingWindowOut | null }`; `createCadence({ now, send, everyMs? }): { keyDown(k), keyUp(code), inserted(chars, via, line), stop() }`.

- [ ] **Step 1: Write the failing tests**

Create `cadence.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CadenceAggregator, MAX_RHYTHM_GAP_MS, WINDOW_MS, classifyKey, createCadence } from './cadence'

const key = (over: { key?: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {}) => ({
  key: 'a', ctrlKey: false, metaKey: false, altKey: false, ...over,
})

/** Presses a character key after each gap (ms), holding it 90 ms; returns the time of the last press. */
function type(agg: CadenceAggregator, gaps: number[], opts: { start?: number; trusted?: boolean } = {}): number {
  let at = opts.start ?? 0
  for (const gap of gaps) {
    at += gap
    agg.keyDown({ cls: 'char', at, code: 'KeyA', trusted: opts.trusted ?? true })
    agg.keyUp('KeyA', at + 90)
  }
  return at
}

describe('classifyKey', () => {
  it('sorts keys into characters, corrections and navigation', () => {
    expect(classifyKey(key({ key: 'a' }))).toBe('char')
    expect(classifyKey(key({ key: ' ' }))).toBe('char')
    expect(classifyKey(key({ key: 'Enter' }))).toBe('char')
    expect(classifyKey(key({ key: 'Tab' }))).toBe('char')
    expect(classifyKey(key({ key: 'Backspace' }))).toBe('backspace')
    expect(classifyKey(key({ key: 'Delete' }))).toBe('backspace')
    expect(classifyKey(key({ key: 'ArrowUp' }))).toBe('nav')
    expect(classifyKey(key({ key: 'PageDown' }))).toBe('nav')
    expect(classifyKey(key({ key: 'Shift' }))).toBe('other')
    expect(classifyKey(key({ key: 'Escape' }))).toBe('other')
  })

  it('does not count shortcuts but does count characters made with Alt or AltGr', () => {
    expect(classifyKey(key({ key: 'c', ctrlKey: true }))).toBe('other')
    expect(classifyKey(key({ key: 'c', metaKey: true }))).toBe('other')
    expect(classifyKey(key({ key: '|', altKey: true }))).toBe('char')               // macOS Option
    expect(classifyKey(key({ key: '{', ctrlKey: true, altKey: true }))).toBe('char')  // Windows AltGr
  })
})

describe('CadenceAggregator', () => {
  it('summarises a human-like stretch: varied gaps, a pause, corrections', () => {
    const agg = new CadenceAggregator()
    const last = type(agg, [120, 95, 310, 140, 2600, 180, 110, 90, 400, 150])
    agg.keyDown({ cls: 'backspace', at: last + 200, code: 'Backspace', trusted: true })
    agg.keyDown({ cls: 'nav', at: last + 300, code: 'ArrowUp', trusted: true })
    const out = agg.flush(6000)!
    expect(out).toMatchObject({ t1: 6000, keys: 10, backspaces: 1, nav: 1, longest_pause: 2600, untrusted: 0, charless: 0 })
    expect(out.iki!.median).toBe(150)
    expect(out.iki!.cv).toBeGreaterThan(0.5)
    expect(out.dwell).toEqual({ median: 90, cv: 0 })
  })

  it('shows a metronome as a rhythm with no spread', () => {
    const agg = new CadenceAggregator()
    type(agg, Array(100).fill(30))
    const out = agg.flush(10_000)!
    expect(out.keys).toBe(100)
    expect(out.iki).toEqual({ median: 30, cv: 0 })
  })

  it('leaves out the statistics when there are too few samples', () => {
    const agg = new CadenceAggregator()
    type(agg, [100, 100, 100, 100])   // four keys, three gaps
    const out = agg.flush(1000)!
    expect(out.iki).toBeUndefined()
    expect(out.dwell).toBeUndefined()
  })

  it('treats a long gap as a pause, not as part of the rhythm', () => {
    const agg = new CadenceAggregator()
    type(agg, [100, 100, 100, MAX_RHYTHM_GAP_MS + 2000, 100, 100, 100])
    const out = agg.flush(30_000)!
    expect(out.longest_pause).toBe(MAX_RHYTHM_GAP_MS + 2000)
    expect(out.iki).toEqual({ median: 100, cv: 0 })
  })

  it('counts synthetic keys, even from a window with no characters', () => {
    const agg = new CadenceAggregator()
    agg.keyDown({ cls: 'other', at: 10, code: 'KeyA', trusted: false })
    expect(agg.flush(100)).toMatchObject({ keys: 0, untrusted: 1 })
  })

  it('counts only unattributed inserts of 30 or more characters as characters with no keys', () => {
    const agg = new CadenceAggregator()
    agg.inserted(35, 'other', 1)
    agg.inserted(29, 'other', 1)
    agg.inserted(500, 'local_paste', 1)
    agg.inserted(500, 'undo', 1)
    agg.inserted(500, 'interviewer', 1)
    expect(agg.flush(100)).toMatchObject({ keys: 0, chars: 0, charless: 35 })
  })

  it('counts typed characters and jumps back to earlier lines', () => {
    const agg = new CadenceAggregator()
    type(agg, [100])
    agg.inserted(1, 'typed', 3)
    agg.inserted(1, 'typed', 4)
    agg.inserted(1, 'typed', 2)
    expect(agg.flush(100)).toMatchObject({ chars: 3, jumps: 1 })
  })

  it('returns nothing for a quiet window and starts the next one fresh', () => {
    const agg = new CadenceAggregator()
    expect(agg.flush(100)).toBeNull()
    type(agg, [100, 100])
    expect(agg.flush(200)).not.toBeNull()
    expect(agg.flush(300)).toBeNull()
  })

  it('drops a hold time that is clearly a missed key release', () => {
    const agg = new CadenceAggregator()
    agg.keyDown({ cls: 'char', at: 0, code: 'KeyA', trusted: true })
    agg.keyUp('KeyA', 60_000)
    type(agg, [100, 100, 100, 100, 100])
    expect(agg.flush(70_000)!.dwell).toEqual({ median: 90, cv: 0 })
  })
})

describe('createCadence', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('sends a window every five seconds while there is something to say, and the rest when stopped', () => {
    const send = vi.fn()
    const cadence = createCadence({ now: () => Date.now(), send })
    cadence.keyDown({ cls: 'char', at: Date.now(), code: 'KeyA', trusted: true })
    vi.advanceTimersByTime(WINDOW_MS)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0]).toMatchObject({ keys: 1 })
    vi.advanceTimersByTime(WINDOW_MS)
    expect(send).toHaveBeenCalledTimes(1)   // nothing typed since: nothing sent
    cadence.keyDown({ cls: 'char', at: Date.now(), code: 'KeyB', trusted: true })
    cadence.stop()
    expect(send).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(WINDOW_MS * 3)
    expect(send).toHaveBeenCalledTimes(2)   // the timer is gone
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail** (when the user has said to run tests)

Run (from `apps/web`): `pnpm exec vitest run features/interview-live/proctor/cadence.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `cadence.ts`**

```ts
/**
 * Typing cadence (live integrity spec §6.2): how the candidate types, as counts and timing statistics for each stretch of
 * five seconds. No key identity and no character is ever kept or sent; the worker decides what the rhythm means.
 */
import type { EditVia } from '../protocol/messages'
import { UNATTRIBUTED_MIN_CHARS } from '../activity/provenance'

export const WINDOW_MS = 5000
/** A gap longer than this is a pause, not part of the rhythm. */
export const MAX_RHYTHM_GAP_MS = 10_000
/** A key held longer than this was not typed; its release was probably missed (focus moved while it was down). */
const MAX_DWELL_MS = 2000
/** Fewer samples than this say nothing about rhythm. */
export const MIN_SAMPLES = 5

export type KeyClass = 'char' | 'backspace' | 'nav' | 'other'

export function classifyKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): KeyClass {
  // Ctrl or Cmd shortcuts are not typing. Ctrl+Alt is AltGr on Windows keyboards and Alt is Option on a Mac: both make characters.
  if ((e.ctrlKey && !e.altKey) || e.metaKey) return 'other'
  switch (e.key) {
    case 'Backspace':
    case 'Delete':
      return 'backspace'
    case 'ArrowUp':
    case 'ArrowDown':
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'Home':
    case 'End':
    case 'PageUp':
    case 'PageDown':
      return 'nav'
    case 'Enter':
    case 'Tab':
      return 'char'
    default:
      return e.key.length === 1 ? 'char' : 'other'
  }
}

export interface KeyDown {
  cls: KeyClass
  at: number
  code: string
  trusted: boolean
}

/** The `typing.window` message body, without its `type`. */
export interface TypingWindowOut {
  t0: number
  t1: number
  keys: number
  chars: number
  iki?: { median: number; cv: number }
  dwell?: { median: number; cv: number }
  backspaces: number
  nav: number
  longest_pause: number
  jumps: number
  untrusted: number
  charless: number
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Median and coefficient of variation (spread over mean), or nothing when there are too few samples to mean anything. */
function stat(values: number[]): { median: number; cv: number } | undefined {
  if (values.length < MIN_SAMPLES) return undefined
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length
  const round = (n: number) => Math.round(n * 100) / 100
  return { median: round(median(values)), cv: mean === 0 ? 0 : round(Math.sqrt(variance) / mean) }
}

export class CadenceAggregator {
  private t0: number | null = null
  private keys = 0
  private chars = 0
  private backspaces = 0
  private nav = 0
  private jumps = 0
  private untrusted = 0
  private charless = 0
  private longestPause = 0
  private ikis: number[] = []
  private dwells: number[] = []
  // Carried across windows: the rhythm and the held keys do not restart every five seconds.
  private lastCharAt: number | null = null
  private lastLine: number | null = null
  private readonly down = new Map<string, number>()

  keyDown(k: KeyDown): void {
    if (this.t0 === null) this.t0 = k.at
    if (!k.trusted) this.untrusted += 1
    if (k.cls === 'backspace') {
      this.backspaces += 1
    } else if (k.cls === 'nav') {
      this.nav += 1
    } else if (k.cls === 'char') {
      this.keys += 1
      if (this.lastCharAt !== null) {
        const gap = k.at - this.lastCharAt
        if (gap > this.longestPause) this.longestPause = gap
        if (gap <= MAX_RHYTHM_GAP_MS) this.ikis.push(gap)
      }
      this.lastCharAt = k.at
      this.down.set(k.code, k.at)
    }
  }

  keyUp(code: string, at: number): void {
    const start = this.down.get(code)
    if (start === undefined) return
    this.down.delete(code)
    const held = at - start
    if (held <= MAX_DWELL_MS) this.dwells.push(held)
  }

  /** A change to the code: typed characters and jumps back count as typing; a long unexplained insert is "no keys". */
  inserted(chars: number, via: EditVia, line: number): void {
    if (via === 'typed') {
      this.chars += chars
      if (this.lastLine !== null && line < this.lastLine) this.jumps += 1
      this.lastLine = line
    } else if (via === 'other' && chars >= UNATTRIBUTED_MIN_CHARS) {
      this.charless += chars
    }
  }

  flush(now: number): TypingWindowOut | null {
    const quiet = this.keys === 0 && this.untrusted === 0 && this.charless === 0
    const iki = stat(this.ikis)
    const dwell = stat(this.dwells)
    const out: TypingWindowOut | null = quiet
      ? null
      : {
          t0: this.t0 ?? now, t1: now, keys: this.keys, chars: this.chars,
          ...(iki ? { iki } : {}), ...(dwell ? { dwell } : {}),
          backspaces: this.backspaces, nav: this.nav, longest_pause: this.longestPause,
          jumps: this.jumps, untrusted: this.untrusted, charless: this.charless,
        }
    this.t0 = null
    this.keys = this.chars = this.backspaces = this.nav = this.jumps = this.untrusted = this.charless = 0
    this.longestPause = 0
    this.ikis = []
    this.dwells = []
    return out
  }
}

export interface CadenceDeps {
  now(): number
  send(window: TypingWindowOut): void
  everyMs?: number
}

/** The aggregator on a five-second timer. `stop` sends what is left and ends the timer. */
export function createCadence(deps: CadenceDeps) {
  const aggregator = new CadenceAggregator()
  const emit = () => {
    const window = aggregator.flush(deps.now())
    if (window) deps.send(window)
  }
  const timer = setInterval(emit, deps.everyMs ?? WINDOW_MS)
  return {
    keyDown: (k: KeyDown) => aggregator.keyDown(k),
    keyUp: (code: string) => aggregator.keyUp(code, deps.now()),
    inserted: (chars: number, via: EditVia, line: number) => aggregator.inserted(chars, via, line),
    stop() {
      clearInterval(timer)
      emit()
    },
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass** (when the user has said to run tests)

Run (from `apps/web`): `pnpm exec vitest run features/interview-live/proctor/cadence.test.ts`
Expected: PASS.

- [ ] **Step 5: Leave the files in the working tree** (no commit): `cadence.ts`, `cadence.test.ts`.

---
### Task 6: The return clock in the browser

**Files:**
- Create: `apps/web/features/interview-live/proctor/awayEpisode.ts`, `useAwayCountdown.ts`
- Test: `apps/web/features/interview-live/proctor/awayEpisode.test.ts`, `useAwayCountdown.test.tsx`
- Modify: `apps/web/features/interview-live/proctor/useProctor.ts`, `useProctor.test.tsx`

**Interfaces:**
- Consumes: `AwayKind`, `WebMessageBody` (Task 1); `ForeignInsert` (Task 3); `wasCleared` (Task 2).
- Produces: `AWAY_LIMIT_TAB_S = 15`, `AWAY_LIMIT_SCREEN_S = 30`, `AWAY_CAP_S = 60`; `AwaySignals { fullscreen, hidden, blurred, shareLost }`; `awayKinds(s): AwayKind[]`; `AwayEpisode { startedAt: number; kinds: AwayKind[]; tight: boolean }`; `limitSeconds(e)`; `nextEpisode(prev, kinds, now): { episode: AwayEpisode | null; change: AwayChange | null }`; `Countdown { phase: 'limit' | 'cap'; seconds: number }`; `countdown(episode, now): Countdown`; `useAwayCountdown(away): Countdown | null`; `ProctorState` gains `away: AwayEpisode | null` and `foreignPaste(info: ForeignInsert): void`; `PASTE_TEXT`.

- [ ] **Step 1: Write the failing tests for the pure clock**

Create `awayEpisode.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { AWAY_CAP_S, AWAY_LIMIT_SCREEN_S, AWAY_LIMIT_TAB_S, awayKinds, countdown, limitSeconds, nextEpisode, type AwayEpisode } from './awayEpisode'

const here = { fullscreen: true, hidden: false, blurred: false, shareLost: false }

describe('awayKinds', () => {
  it('is empty while the candidate is on the screen', () => {
    expect(awayKinds(here)).toEqual([])
  })

  it('lists every active signal in a fixed order', () => {
    expect(awayKinds({ fullscreen: false, hidden: true, blurred: false, shareLost: true })).toEqual(['tab_hidden', 'fullscreen_exit', 'share_stopped'])
  })

  it('does not count the window blur a hidden tab always causes', () => {
    expect(awayKinds({ ...here, hidden: true, blurred: true })).toEqual(['tab_hidden'])
    expect(awayKinds({ ...here, blurred: true })).toEqual(['window_blur'])
  })
})

describe('nextEpisode', () => {
  it('starts an episode at the first signal; leaving only full screen has the looser limit', () => {
    const { episode, change } = nextEpisode(null, ['fullscreen_exit'], 1000)
    expect(episode).toEqual({ startedAt: 1000, kinds: ['fullscreen_exit'], tight: false })
    expect(change).toEqual({ type: 'start', episode })
    expect(limitSeconds(episode!)).toBe(AWAY_LIMIT_SCREEN_S)
  })

  it('leaving the tab or the window has the strict limit', () => {
    expect(nextEpisode(null, ['tab_hidden'], 1000).episode).toMatchObject({ tight: true })
    expect(limitSeconds({ tight: true })).toBe(AWAY_LIMIT_TAB_S)
    expect(nextEpisode(null, ['window_blur'], 1000).episode).toMatchObject({ tight: true })
  })

  it('reports nothing while the set of signals is unchanged', () => {
    const prev: AwayEpisode = { startedAt: 1000, kinds: ['fullscreen_exit'], tight: false }
    const next = nextEpisode(prev, ['fullscreen_exit'], 5000)
    expect(next.episode).toBe(prev)
    expect(next.change).toBeNull()
  })

  it('reports a changed set, keeps the start, and latches the strict limit even after the tab is back', () => {
    const prev: AwayEpisode = { startedAt: 1000, kinds: ['fullscreen_exit'], tight: false }
    const joined = nextEpisode(prev, ['tab_hidden', 'fullscreen_exit'], 4000)
    expect(joined.episode).toEqual({ startedAt: 1000, kinds: ['tab_hidden', 'fullscreen_exit'], tight: true })
    expect(joined.change).toEqual({ type: 'update', episode: joined.episode })
    const left = nextEpisode(joined.episode, ['fullscreen_exit'], 6000)
    expect(left.episode).toEqual({ startedAt: 1000, kinds: ['fullscreen_exit'], tight: true })
  })

  it('ends the episode when everything is back and says whether it ran past the limit', () => {
    const screen: AwayEpisode = { startedAt: 0, kinds: ['fullscreen_exit'], tight: false }
    expect(nextEpisode(screen, [], 29_000)).toEqual({ episode: null, change: { type: 'back', awayMs: 29_000, overLimit: false, limitS: 30 } })
    expect(nextEpisode(screen, [], 30_000).change).toMatchObject({ overLimit: true })
    const tab: AwayEpisode = { startedAt: 0, kinds: ['tab_hidden'], tight: true }
    expect(nextEpisode(tab, [], 16_000).change).toMatchObject({ overLimit: true, limitS: 15 })
  })

  it('has nothing to say when there was no episode and there is none', () => {
    expect(nextEpisode(null, [], 1000)).toEqual({ episode: null, change: null })
  })
})

describe('countdown', () => {
  const tab: AwayEpisode = { startedAt: 10_000, kinds: ['tab_hidden'], tight: true }

  it('counts down to the limit, rounding up', () => {
    expect(countdown(tab, 10_000)).toEqual({ phase: 'limit', seconds: 15 })
    expect(countdown(tab, 10_001)).toEqual({ phase: 'limit', seconds: 15 })
    expect(countdown(tab, 24_500)).toEqual({ phase: 'limit', seconds: 1 })
  })

  it('then counts down to the cap, and never below zero', () => {
    expect(countdown(tab, 25_000)).toEqual({ phase: 'cap', seconds: AWAY_CAP_S - 15 })
    expect(countdown(tab, 70_000)).toEqual({ phase: 'cap', seconds: 0 })
    expect(countdown(tab, 500_000)).toEqual({ phase: 'cap', seconds: 0 })
  })

  it('treats a clock reading from before the episode as its start', () => {
    expect(countdown(tab, 2_000)).toEqual({ phase: 'limit', seconds: 15 })
  })
})
```

Create `useAwayCountdown.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { AwayEpisode } from './awayEpisode'
import { useAwayCountdown } from './useAwayCountdown'

beforeEach(() => {
  vi.useFakeTimers()
  document.title = 'Interview'
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useAwayCountdown', () => {
  it('counts down once a second, to the limit and then the cap, and shows it in the tab title', () => {
    const away: AwayEpisode = { startedAt: Date.now(), kinds: ['tab_hidden'], tight: true }
    const { result, unmount } = renderHook(() => useAwayCountdown(away))
    expect(result.current).toEqual({ phase: 'limit', seconds: 15 })
    expect(document.title).toBe('⚠ Return in 15 s')
    act(() => { vi.advanceTimersByTime(4000) })
    expect(result.current).toEqual({ phase: 'limit', seconds: 11 })
    act(() => { vi.advanceTimersByTime(11_000) })
    expect(result.current).toEqual({ phase: 'cap', seconds: 45 })
    expect(document.title).toBe('⚠ Interview ends in 45 s')
    unmount()
    expect(document.title).toBe('Interview')
  })

  it('is nothing, and leaves the title alone, while the candidate is on the screen', () => {
    const { result } = renderHook(() => useAwayCountdown(null))
    expect(result.current).toBeNull()
    expect(document.title).toBe('Interview')
  })

  it('restores the title when the candidate comes back', () => {
    const away: AwayEpisode = { startedAt: Date.now(), kinds: ['fullscreen_exit'], tight: false }
    const { rerender } = renderHook(({ a }: { a: AwayEpisode | null }) => useAwayCountdown(a), { initialProps: { a: away as AwayEpisode | null } })
    expect(document.title).toBe('⚠ Return in 30 s')
    rerender({ a: null })
    expect(document.title).toBe('Interview')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail** (when the user has said to run tests)

Run (from `apps/web`): `pnpm exec vitest run features/interview-live/proctor/awayEpisode.test.ts features/interview-live/proctor/useAwayCountdown.test.tsx`
Expected: FAIL (modules not found).

- [ ] **Step 3: Write `awayEpisode.ts`**

```ts
/**
 * The return clock's browser half (live integrity spec §7): which away signals are active, where an episode starts and
 * ends, and what the candidate is told. The worker times the episode on its own clock and decides what it costs; this
 * only reports it and counts down.
 */
import type { AwayKind } from '../protocol/messages'

/** Leaving the tab or the window: back within this, or it counts as another violation. */
export const AWAY_LIMIT_TAB_S = 15
/** Leaving full screen or stopping the share, and nothing else. */
export const AWAY_LIMIT_SCREEN_S = 30
/** Away this long ends the interview, whatever the cause. */
export const AWAY_CAP_S = 60

export interface AwaySignals {
  fullscreen: boolean
  hidden: boolean
  blurred: boolean
  /** A share that was running has stopped; a room that never had one has not lost it. */
  shareLost: boolean
}

/** The away signals active right now, in a fixed order. A hidden tab always blurs the window too; that is one signal. */
export function awayKinds(s: AwaySignals): AwayKind[] {
  const kinds: AwayKind[] = []
  if (s.hidden) kinds.push('tab_hidden')
  if (s.blurred && !s.hidden) kinds.push('window_blur')
  if (!s.fullscreen) kinds.push('fullscreen_exit')
  if (s.shareLost) kinds.push('share_stopped')
  return kinds
}

export interface AwayEpisode {
  startedAt: number
  /** Every away signal active now. */
  kinds: AwayKind[]
  /** True once the tab or the window has been left at any point in the episode: the strict limit then applies. */
  tight: boolean
}

const leftTabOrWindow = (kinds: readonly AwayKind[]) => kinds.includes('tab_hidden') || kinds.includes('window_blur')

export function limitSeconds(episode: Pick<AwayEpisode, 'tight'>): number {
  return episode.tight ? AWAY_LIMIT_TAB_S : AWAY_LIMIT_SCREEN_S
}

export type AwayChange =
  | { type: 'start' | 'update'; episode: AwayEpisode }
  | { type: 'back'; awayMs: number; overLimit: boolean; limitS: number }

/** One step of the tracker: an episode starts at the first signal, updates when the set changes, and ends when it is empty. */
export function nextEpisode(prev: AwayEpisode | null, kinds: AwayKind[], now: number): { episode: AwayEpisode | null; change: AwayChange | null } {
  if (kinds.length === 0) {
    if (!prev) return { episode: null, change: null }
    const awayMs = now - prev.startedAt
    const limitS = limitSeconds(prev)
    return { episode: null, change: { type: 'back', awayMs, overLimit: awayMs >= limitS * 1000, limitS } }
  }
  if (!prev) {
    const episode: AwayEpisode = { startedAt: now, kinds, tight: leftTabOrWindow(kinds) }
    return { episode, change: { type: 'start', episode } }
  }
  if (prev.kinds.join() === kinds.join()) return { episode: prev, change: null }
  const episode: AwayEpisode = { ...prev, kinds, tight: prev.tight || leftTabOrWindow(kinds) }
  return { episode, change: { type: 'update', episode } }
}

export interface Countdown {
  /** `limit`: seconds left before it counts as another violation. `cap`: seconds left before the interview ends. */
  phase: 'limit' | 'cap'
  seconds: number
}

export function countdown(episode: AwayEpisode, now: number): Countdown {
  const elapsed = Math.max(0, (now - episode.startedAt) / 1000)
  const limit = limitSeconds(episode)
  if (elapsed < limit) return { phase: 'limit', seconds: Math.ceil(limit - elapsed) }
  return { phase: 'cap', seconds: Math.max(0, Math.ceil(AWAY_CAP_S - elapsed)) }
}
```

- [ ] **Step 4: Write `useAwayCountdown.ts`**

```ts
'use client'
import { useEffect, useState } from 'react'
import { countdown, type AwayEpisode, type Countdown } from './awayEpisode'

export function countdownLabel(c: Countdown): string {
  return c.phase === 'limit' ? `⚠ Return in ${c.seconds} s` : `⚠ Interview ends in ${c.seconds} s`
}

/** Counts an away episode down once a second and shows the count in the tab title while it lasts: from another tab, the
 * title is the only thing of the room the candidate can see. */
export function useAwayCountdown(away: AwayEpisode | null): Countdown | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!away) return
    setNow(Date.now())
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [away])

  const current = away ? countdown(away, now) : null
  const label = current ? countdownLabel(current) : null
  useEffect(() => {
    if (!label) return
    const original = document.title
    document.title = label
    return () => {
      document.title = original
    }
  }, [label])
  return current
}
```

- [ ] **Step 5: Write the failing tests for `useProctor`**

In `useProctor.test.tsx`, change the imports at the top:

```ts
import { WARNING_TEXT, PASTE_TEXT, useProctor } from './useProctor'
import { clearSystemClipboard, resetClipboard } from './localClipboard'
```

Append at the end of the file:

```ts
describe('useProctor return clock', () => {
  it('opens an episode when full screen is left, tells the worker at once, and closes it on return', () => {
    const session = new MockLiveSession()
    const { result } = renderHook(() => useProctor({ session, enabled: true }))
    expect(result.current.away).toBeNull()
    act(() => setFullscreen(false))
    expect(result.current.away).toMatchObject({ kinds: ['fullscreen_exit'], tight: false })
    expect(session.sentOf('proctor.away')).toEqual([expect.objectContaining({ kinds: ['fullscreen_exit'] })])   // before the 1.5 s merge window
    act(() => setFullscreen(true))
    expect(result.current.away).toBeNull()
    expect(session.sentOf('proctor.back')).toHaveLength(1)
  })

  it('sends the new set when another signal joins, and keeps the strict limit once the tab is left', () => {
    const session = new MockLiveSession()
    const { result } = renderHook(() => useProctor({ session, enabled: true }))
    act(() => setFullscreen(false))
    act(() => { hidden = true; document.dispatchEvent(new Event('visibilitychange')) })
    expect(session.sentOf('proctor.away').at(-1)).toMatchObject({ kinds: ['tab_hidden', 'fullscreen_exit'] })
    expect(result.current.away?.tight).toBe(true)
    act(() => { hidden = false; document.dispatchEvent(new Event('visibilitychange')) })
    expect(result.current.away).toMatchObject({ kinds: ['fullscreen_exit'], tight: true })
  })

  it('tells the candidate they stayed past the limit, and says nothing about a quick return', () => {
    const slow = renderHook(() => useProctor({ session: new MockLiveSession(), enabled: true }))
    act(() => setFullscreen(false))
    act(() => { vi.advanceTimersByTime(31_000) })
    act(() => setFullscreen(true))
    expect(slow.result.current.toast).toMatch(/away 31 s, past the 30 s limit.*extra violation/)
    slow.unmount()

    const quick = renderHook(() => useProctor({ session: new MockLiveSession(), enabled: true }))
    act(() => setFullscreen(false))
    act(() => { vi.advanceTimersByTime(5000) })
    act(() => setFullscreen(true))
    expect(quick.result.current.toast).toBeNull()
  })

  it('does not treat a room that never had a screen share as having lost it', () => {
    const session = new MockLiveSession()
    const { result } = renderHook(() => useProctor({ session, enabled: true }))
    expect(result.current.shareStopped).toBe(true)
    expect(result.current.away).toBeNull()
    expect(session.sentOf('proctor.away')).toHaveLength(0)
  })

  it('opens an episode when a share that was running stops', async () => {
    let end = () => {}
    const track = { kind: 'video', stop: vi.fn(), getSettings: () => ({ displaySurface: 'monitor' }), addEventListener: (_t: string, cb: () => void) => { end = cb } }
    Object.assign(navigator.mediaDevices, { getDisplayMedia: vi.fn(async () => ({ getTracks: () => [track], getVideoTracks: () => [track] })) })
    await requestEntireScreen()
    const session = new MockLiveSession()
    const { result } = renderHook(() => useProctor({ session, enabled: true }))
    expect(result.current.away).toBeNull()
    act(() => end())
    expect(result.current.away).toMatchObject({ kinds: ['share_stopped'], tight: false })
    expect(session.sentOf('proctor.away')).toEqual([expect.objectContaining({ kinds: ['share_stopped'] })])
  })

  it('does not open an episode for a second display, which cannot be undone', () => {
    const scr = window.screen as ExtendedScreen
    let onChange: () => void = () => {}
    Object.defineProperty(scr, 'isExtended', { configurable: true, writable: true, value: false })
    const add = scr.addEventListener
    scr.addEventListener = ((type: string, cb: () => void) => { if (type === 'change') onChange = cb }) as typeof scr.addEventListener
    try {
      const session = new MockLiveSession()
      const { result } = renderHook(() => useProctor({ session, enabled: true }))
      act(() => { scr.isExtended = true; onChange() })
      expect(result.current.ledger.entries[0]).toMatchObject({ kind: 'external_display' })
      expect(result.current.away).toBeNull()
      expect(session.sentOf('proctor.away')).toHaveLength(0)
    } finally {
      scr.addEventListener = add
      Reflect.deleteProperty(scr, 'isExtended')
    }
  })

  it('survives a session that throws while reconnecting', () => {
    const session = new MockLiveSession()
    vi.spyOn(session, 'send').mockImplementation(() => { throw new Error('reconnecting') })
    const { result } = renderHook(() => useProctor({ session, enabled: true }))
    expect(() => act(() => setFullscreen(false))).not.toThrow()
    expect(result.current.away).not.toBeNull()
  })

  it('forgets an open episode when proctoring is switched off', () => {
    const session = new MockLiveSession()
    const { result, rerender } = renderHook(({ enabled }: { enabled: boolean }) => useProctor({ session, enabled }), { initialProps: { enabled: true } })
    act(() => setFullscreen(false))
    expect(result.current.away).not.toBeNull()
    rerender({ enabled: false })
    expect(result.current.away).toBeNull()
  })
})

describe('useProctor foreign paste', () => {
  afterEach(() => {
    resetClipboard()
    vi.unstubAllEnvs()
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  it('shows the warning and tells the worker the size, never the text', () => {
    const session = new MockLiveSession()
    const { result } = renderHook(() => useProctor({ session, enabled: true }))
    act(() => result.current.foreignPaste({ source: 'paste', chars: 120, lines: 6 }))
    expect(result.current.toast).toBe(PASTE_TEXT)
    expect(session.sentOf('proctor.event')).toEqual([
      expect.objectContaining({ kind: 'foreign_paste', weight: 1, source: 'paste', chars: 120, lines: 6, clipboard_cleared: false }),
    ])
  })

  it('says the clipboard was cleared at Join when it was', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } })
    await clearSystemClipboard()
    const session = new MockLiveSession()
    const { result } = renderHook(() => useProctor({ session, enabled: true }))
    act(() => result.current.foreignPaste({ source: 'drop', chars: 9, lines: 1 }))
    expect(session.sentOf('proctor.event')[0]).toMatchObject({ source: 'drop', clipboard_cleared: true })
  })
})
```

- [ ] **Step 6: Run the tests to verify they fail** (when the user has said to run tests)

Run (from `apps/web`): `pnpm exec vitest run features/interview-live/proctor/useProctor.test.tsx`
Expected: FAIL (`away`, `foreignPaste` and `PASTE_TEXT` do not exist).

- [ ] **Step 7: Update `useProctor.ts`**

Replace the import block and the constants/interface at the top of the file with:

```ts
'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProctorKind, WebMessageBody } from '../protocol/messages'
import type { LiveSession } from '../session/types'
import { awayKinds, nextEpisode, type AwayEpisode } from './awayEpisode'
import type { ForeignInsert } from './editorClipboard'
import { EMPTY_LEDGER, MERGE_WINDOW_MS, recordEvent, type Ledger } from './ledger'
import { wasCleared } from './localClipboard'
import { isPrompting, useScreenShared } from './screenShare'
import { useExternalDisplay } from './useExternalDisplay'
import { useFullscreen } from './useFullscreen'
import { useVisibility } from './useVisibility'

export const TOAST_MS = 4000
export const WARNING_TEXT = "Don't change screens while the interview is running."
export const PASTE_TEXT = 'Pasting from outside this editor is blocked, and it ends the interview.'

export interface ProctorState {
  ledger: Ledger
  outOfFullscreen: boolean
  shareStopped: boolean
  toast: string | null
  /** The open away episode, for the countdown; null while the candidate is on the screen. */
  away: AwayEpisode | null
  /** The editor reports text pasted or dropped in from outside the room. */
  foreignPaste: (info: ForeignInsert) => void
}
```

(`Signals` and the doc comment on `useProctor` stay.) Inside `useProctor`, after `const timers = …` add:

```ts
  const [away, setAway] = useState<AwayEpisode | null>(null)
  const awayRef = useRef<AwayEpisode | null>(null)
  // A room that never had a share (local mock mode) has not lost one.
  const everShared = useRef(false)

  /** Sends unless the connection is down: a stretch the interviewer misses is better than a broken room. */
  const safeSend = useCallback((body: WebMessageBody) => {
    try {
      session.send(body)
    } catch {
      // reconnecting
    }
  }, [session])
```

After the `record` callback definition add:

```ts
  const foreignPaste = useCallback((info: ForeignInsert) => {
    setToast(PASTE_TEXT)
    later(TOAST_MS, () => setToast(null))
    // The worker keeps its own ledger, so these counts only satisfy the message.
    safeSend({
      type: 'proctor.event', kind: 'foreign_paste', weight: 1, at: Date.now(),
      counts: { tab_changes: 0, screen_changes: 0, full_violations: 0 },
      source: info.source, chars: info.chars, lines: info.lines, clipboard_cleared: wasCleared(),
    })
  }, [later, safeSend])
```

Replace the big signal effect with:

```ts
  useEffect(() => {
    if (!enabled) {
      prev.current = null
      awayRef.current = null
      setAway(null)
      return
    }
    const now: Signals = { fullscreen: isFullscreen, hidden, blurred, extended, shared }
    const was = prev.current
    prev.current = now
    // On the first run an already-bad state counts, so entering out of full screen isn't a bypass.
    if ((was === null || was.fullscreen) && !now.fullscreen) record('fullscreen_exit')
    if ((was === null || !was.hidden) && now.hidden) record('tab_hidden')
    if ((was === null || !was.blurred) && now.blurred && !now.hidden) record('window_blur')
    // Only a display that appears after the round began counts: one already connected was warned about at the checks.
    if (was !== null && was.extended === false && now.extended === true) record('external_display')
    if (was !== null && was.shared && !now.shared) record('share_stopped')

    // The return clock (spec §7): one episode from the first away signal until everything is back.
    if (shared) everShared.current = true
    const { episode, change } = nextEpisode(awayRef.current, awayKinds({ fullscreen: isFullscreen, hidden, blurred, shareLost: everShared.current && !shared }), Date.now())
    awayRef.current = episode
    setAway(episode)
    if (change?.type === 'start' || change?.type === 'update') {
      safeSend({ type: 'proctor.away', kinds: change.episode.kinds, at: Date.now() })
    } else if (change?.type === 'back') {
      safeSend({ type: 'proctor.back', at: Date.now() })
      if (change.overLimit) {
        setToast(`You were away ${Math.round(change.awayMs / 1000)} s, past the ${change.limitS} s limit. That counts as an extra violation.`)
        later(TOAST_MS, () => setToast(null))
      }
    }
  }, [enabled, isFullscreen, hidden, blurred, extended, shared, record, safeSend, later])
```

and change the returned object to:

```ts
  return {
    ledger,
    outOfFullscreen: enabled && !isFullscreen,
    shareStopped: enabled && !shared,
    toast,
    away,
    foreignPaste,
  }
```

- [ ] **Step 8: Run the tests to verify they pass** (when the user has said to run tests)

Run (from `apps/web`): `pnpm exec vitest run features/interview-live/proctor`
Expected: PASS, including every existing `useProctor` test.

- [ ] **Step 9: Leave the files in the working tree** (no commit): `awayEpisode.ts`, `useAwayCountdown.ts`, their tests, `useProctor.ts`, `useProctor.test.tsx`.

---

### Task 7: The countdown bar and the foreign-paste action in the room

**Files:**
- Create: `apps/web/features/interview-live/proctor/ProctorContext.tsx`
- Test: `apps/web/features/interview-live/proctor/ProctorBars.test.tsx`, `ProctorContext.test.tsx`
- Modify: `apps/web/features/interview-live/proctor/ProctorBars.tsx`, `apps/web/app/(app)/interviews/[sessionId]/live/_components/LiveView.tsx`

**Interfaces:**
- Consumes: `AwayEpisode`, `useAwayCountdown` (Task 6); `ForeignInsert`, `attachRoomCopyGuard` (Task 3); `clipboardRulesActive`, `forgetBuffer` (Task 2).
- Produces: `ProctorActions { foreignPaste(info: ForeignInsert): void }`, `ProctorActionsProvider`, `useProctorActions(): ProctorActions` (a no-op default outside the room); `ProctorBars` gains an optional `away?: AwayEpisode | null` prop.

- [ ] **Step 1: Write the failing tests**

Create `ProctorBars.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import type { AwayEpisode } from './awayEpisode'
import { ProctorBars } from './ProctorBars'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('ProctorBars return clock', () => {
  it('counts down to the limit, then to the end of the interview', () => {
    const away: AwayEpisode = { startedAt: Date.now(), kinds: ['tab_hidden'], tight: true }
    render(<ProctorBars outOfFullscreen={false} shareStopped={false} toast={null} away={away} />)
    expect(screen.getByText(/Return to the interview within 15 s/)).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(20_000) })
    expect(screen.getByText(/Return now\. The interview ends in 40 s/)).toBeInTheDocument()
  })

  it('says nothing about time while the candidate is on the screen', () => {
    render(<ProctorBars outOfFullscreen={false} shareStopped={false} toast={null} away={null} />)
    expect(screen.queryByText(/Return/)).toBeNull()
  })

  it('still shows the return-to-full-screen bar beside the countdown', () => {
    const away: AwayEpisode = { startedAt: Date.now(), kinds: ['fullscreen_exit'], tight: false }
    render(<ProctorBars outOfFullscreen shareStopped={false} toast={null} away={away} />)
    expect(screen.getByRole('button', { name: 'Return to full screen' })).toBeInTheDocument()
    expect(screen.getByText(/within 30 s/)).toBeInTheDocument()
  })
})
```

Create `ProctorContext.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { ProctorActionsProvider, useProctorActions } from './ProctorContext'

describe('useProctorActions', () => {
  it('is a harmless no-op outside the live room', () => {
    const { result } = renderHook(() => useProctorActions())
    expect(() => result.current.foreignPaste({ source: 'paste', chars: 1, lines: 1 })).not.toThrow()
  })

  it('hands the room its actions', () => {
    const foreignPaste = vi.fn()
    const { result } = renderHook(() => useProctorActions(), {
      wrapper: ({ children }) => <ProctorActionsProvider value={{ foreignPaste }}>{children}</ProctorActionsProvider>,
    })
    result.current.foreignPaste({ source: 'drop', chars: 5, lines: 1 })
    expect(foreignPaste).toHaveBeenCalledWith({ source: 'drop', chars: 5, lines: 1 })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail** (when the user has said to run tests)

Run (from `apps/web`): `pnpm exec vitest run features/interview-live/proctor/ProctorBars.test.tsx features/interview-live/proctor/ProctorContext.test.tsx`
Expected: FAIL (no `away` prop; module not found).

- [ ] **Step 3: Write `ProctorContext.tsx`**

```tsx
'use client'
import { createContext, useContext } from 'react'
import type { ForeignInsert } from './editorClipboard'

/** What the room's panes can tell the proctor: the editor reports text that came from outside the room. */
export interface ProctorActions {
  foreignPaste(info: ForeignInsert): void
}

const Ctx = createContext<ProctorActions>({ foreignPaste: () => {} })

export const ProctorActionsProvider = Ctx.Provider

export function useProctorActions(): ProctorActions {
  return useContext(Ctx)
}
```

- [ ] **Step 4: Add the countdown to `ProctorBars.tsx`**

Add the imports:

```tsx
import type { AwayEpisode } from './awayEpisode'
import { useAwayCountdown } from './useAwayCountdown'
```

Add `away = null` to the props destructuring and the prop type (`away?: AwayEpisode | null`), call `const clock = useAwayCountdown(away)` next to the `shareError` state, and render this just before the `{outOfFullscreen ? (` block:

```tsx
      {clock ? (
        <div role="status" className="flex flex-none items-center gap-3 border-b border-line-2 bg-panel px-4 py-2 text-[13px]">
          <StatusDot state="warn" srLabel="Warning" />
          <span className="min-w-0 flex-1">
            {clock.phase === 'limit'
              ? `Return to the interview within ${clock.seconds} s. After that it counts as another violation.`
              : `Return now. The interview ends in ${clock.seconds} s.`}
          </span>
        </div>
      ) : null}
```

Update the doc comment of `ProctorBars` to end: "…and a countdown while the candidate is away. The round keeps running."

- [ ] **Step 5: Wire `LiveView.tsx`**

Add imports:

```tsx
import { useEffect, useMemo } from 'react'
import { attachRoomCopyGuard } from '@/features/interview-live/proctor/editorClipboard'
import { clipboardRulesActive, forgetBuffer } from '@/features/interview-live/proctor/localClipboard'
import { ProctorActionsProvider } from '@/features/interview-live/proctor/ProctorContext'
```

After `const proctor = useProctor({ session, enabled: true })` add:

```tsx
  const proctorActions = useMemo(() => ({ foreignPaste: proctor.foreignPaste }), [proctor.foreignPaste])
  // Copy and cut anywhere in the room stay in the room (the editor guards its own); only while the clipboard rules are on.
  useEffect(() => {
    if (!clipboardRulesActive()) return
    const detach = attachRoomCopyGuard(document)
    return () => {
      detach()
      forgetBuffer()
    }
  }, [])
```

Wrap the returned tree: the outermost element becomes `<ProctorActionsProvider value={proctorActions}>…</ProctorActionsProvider>` around the existing `<ActivityProvider …>…</ActivityProvider>`, and pass the episode to the bars:

```tsx
          <ProctorBars outOfFullscreen={proctor.outOfFullscreen} shareStopped={proctor.shareStopped} toast={proctor.toast} away={proctor.away} presence={presence} />
```

- [ ] **Step 6: Run the tests to verify they pass** (when the user has said to run tests)

Run (from `apps/web`): `pnpm exec vitest run features/interview-live/proctor "app/(app)/interviews/[sessionId]/live/_components/LiveView.test.tsx"`
Expected: PASS (the existing `LiveView` tests still pass: the clipboard rules are off under test, so the room guard is not attached).

- [ ] **Step 7: Leave the files in the working tree** (no commit): `ProctorContext.tsx`, `ProctorBars.tsx`, `LiveView.tsx`, and the two new test files.

---
### Task 8: Wire the editor

**Files:**
- Create: `apps/web/features/interview-live/work/editorIntegrity.ts`
- Test: `apps/web/features/interview-live/work/editorIntegrity.test.ts`, `CodeEditor.options.test.tsx`
- Modify: `apps/web/features/interview-live/work/CodeEditor.tsx`

**Interfaces:**
- Consumes: `createProvenance` (Task 4); `createCadence`, `classifyKey` (Task 5); `attachEditorClipboard`, `ClipboardEditor`, `ForeignInsert` (Task 3); `clipboardRulesActive` (Task 2); `useProctorActions` (Task 7); `attachCodeActivity`'s new `classify` argument (Task 4).
- Produces: `NO_ASSIST_OPTIONS`, `CLIPBOARD_RULE_OPTIONS` (Monaco option objects); `ContentChangeEvent`, `IntegrityEditor`, `IntegrityMonaco`, `IntegrityDeps`; `attachEditorIntegrity(editor, monaco, deps): EditorIntegrity` where `EditorIntegrity { classify(change: { text: string }, event: { isUndoing?: boolean; isRedoing?: boolean }): EditVia; dispose(): void }`.

- [ ] **Step 1: Write the failing tests**

Create `editorIntegrity.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebMessageBody } from '../protocol/messages'
import { resetClipboard } from '../proctor/localClipboard'
import { CLIPBOARD_RULE_OPTIONS, NO_ASSIST_OPTIONS, attachEditorIntegrity, type ContentChangeEvent, type IntegrityEditor } from './editorIntegrity'

const monaco = { KeyCode: { F1: 59, Space: 10 }, KeyMod: { CtrlCmd: 2048 } }

function setup(over: { ignoring?: boolean; interviewerEditing?: boolean } = {}) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const handlers: { content?: (e: ContentChangeEvent) => void } = {}
  const commands: number[] = []
  const editor: IntegrityEditor = {
    getDomNode: () => host,
    addCommand: (key: number) => { commands.push(key); return 'id' },
    onDidChangeModelContent: (cb) => { handlers.content = cb; return { dispose: vi.fn() } },
    getSelections: () => [],
    getModel: () => null,
    executeEdits: vi.fn(() => true),
    pushUndoStop: vi.fn(() => true),
    trigger: vi.fn(),
  }
  const sent: WebMessageBody[] = []
  const onForeign = vi.fn()
  const integrity = attachEditorIntegrity(editor, monaco, {
    send: (m) => sent.push(m),
    interviewerEditing: () => over.interviewerEditing ?? false,
    ignoring: () => over.ignoring ?? false,
    onForeign,
  })
  const key = (type: 'keydown' | 'keyup', init: KeyboardEventInit = {}) =>
    host.dispatchEvent(new KeyboardEvent(type, { key: 'a', code: 'KeyA', bubbles: true, ...init }))
  const change = (text: string, extra: Partial<ContentChangeEvent> = {}) =>
    handlers.content!({ changes: [{ range: { startLineNumber: 1 }, text }], isFlush: false, ...extra })
  const windows = () => sent.filter((m) => m.type === 'typing.window')
  return { host, commands, editor, sent, onForeign, integrity, key, change, windows }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  resetClipboard()
  document.body.innerHTML = ''
})

describe('attachEditorIntegrity', () => {
  it('switches off the command palette and the manual suggestion popup', () => {
    const { commands, integrity } = setup()
    expect(commands).toEqual([monaco.KeyCode.F1, monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space])
    integrity.dispose()
  })

  it('reports keys that a script, not a keyboard, produced as synthetic', () => {
    const { key, integrity, windows } = setup()
    for (let i = 0; i < 6; i++) { key('keydown'); key('keyup') }   // dispatched by script: isTrusted is false
    integrity.dispose()
    expect(windows()).toEqual([expect.objectContaining({ type: 'typing.window', keys: 6, untrusted: 6 })])
  })

  it('does not take a held key for a rhythm', () => {
    const { key, integrity, windows } = setup()
    for (let i = 0; i < 5; i++) key('keydown', { repeat: true })
    integrity.dispose()
    expect(windows()).toHaveLength(0)
  })

  it('counts typed characters, and long text that arrived with no key as injected', () => {
    const { key, change, integrity, windows } = setup()
    key('keydown')
    change('a')
    change('x'.repeat(45))
    integrity.dispose()
    expect(windows()).toEqual([expect.objectContaining({ keys: 1, chars: 1, charless: 45 })])
  })

  it('does not take undo, redo, a flush, the interviewer or the starter swap for injected text', () => {
    for (const over of [{ interviewerEditing: true }, { ignoring: true }]) {
      const { change, integrity, windows } = setup(over)
      change('x'.repeat(100))
      integrity.dispose()
      expect(windows()).toHaveLength(0)
    }
    const { change, integrity, windows } = setup()
    change('x'.repeat(100), { isUndoing: true })
    change('x'.repeat(100), { isRedoing: true })
    change('x'.repeat(100), { isFlush: true })
    integrity.dispose()
    expect(windows()).toHaveLength(0)
  })

  it('tags edits for the activity stream by how they arrived', () => {
    const { key, integrity } = setup()
    expect(integrity.classify({ text: 'x' }, {})).toBe('other')
    key('keydown')
    expect(integrity.classify({ text: 'x' }, {})).toBe('typed')
    expect(integrity.classify({ text: 'x' }, { isUndoing: true })).toBe('undo')
    integrity.dispose()
  })

  it('guards the clipboard only while the rules are active', () => {
    const paste = () => {
      const event = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', { value: { getData: () => 'def solve(): pass', setData: () => {} } })
      return event
    }

    vi.stubEnv('NODE_ENV', 'production')
    const live = setup()
    const blocked = paste()
    live.host.dispatchEvent(blocked)
    expect(blocked.defaultPrevented).toBe(true)
    expect(live.onForeign).toHaveBeenCalledWith({ source: 'paste', chars: 17, lines: 1 })
    live.integrity.dispose()

    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXT_PUBLIC_ENFORCE_CLIPBOARD', '')
    const dev = setup()
    const native = paste()
    dev.host.dispatchEvent(native)
    expect(native.defaultPrevented).toBe(false)
    expect(dev.onForeign).not.toHaveBeenCalled()
    dev.integrity.dispose()
  })

  it('sends what is left and stops listening once disposed', () => {
    const { key, integrity, windows, sent } = setup()
    key('keydown')
    integrity.dispose()
    expect(windows()).toHaveLength(1)
    const before = sent.length
    key('keydown')
    vi.advanceTimersByTime(20_000)
    expect(sent).toHaveLength(before)
  })
})

describe('editor options', () => {
  it('offers no completions, snippets or suggestions', () => {
    expect(NO_ASSIST_OPTIONS).toMatchObject({
      quickSuggestions: false, suggestOnTriggerCharacters: false, acceptSuggestionOnEnter: 'off', tabCompletion: 'off',
      snippetSuggestions: 'none', wordBasedSuggestions: 'off',
    })
  })

  it('closes the paste side doors: context menu, drop, paste-as and drag', () => {
    expect(CLIPBOARD_RULE_OPTIONS).toMatchObject({ contextmenu: false, dropIntoEditor: { enabled: false }, pasteAs: { enabled: false }, dragAndDrop: false })
  })
})
```

Create `CodeEditor.options.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MockLiveSession } from '../session/MockLiveSession'
import { WorkspaceProvider } from '../workspace/WorkspaceProvider'
import { CodeEditor } from './CodeEditor'

vi.mock('next/dynamic', () => ({ default: () => ({ options }: { options: object }) => <div data-testid="monaco" data-options={JSON.stringify(options)} /> }))
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'dark' }) }))

afterEach(() => { vi.unstubAllEnvs() })

function optionsOf(): Record<string, unknown> {
  const session = new MockLiveSession()
  render(<WorkspaceProvider session={session}><CodeEditor session={session} /></WorkspaceProvider>)
  return JSON.parse(screen.getByTestId('monaco').getAttribute('data-options')!)
}

describe('CodeEditor options', () => {
  it('never offers completions, even in dev', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXT_PUBLIC_ENFORCE_CLIPBOARD', '')
    expect(optionsOf()).toMatchObject({ quickSuggestions: false, snippetSuggestions: 'none', minimap: { enabled: false } })
  })

  it('leaves native paste, drop and the context menu alone in dev', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXT_PUBLIC_ENFORCE_CLIPBOARD', '')
    const options = optionsOf()
    expect(options).not.toHaveProperty('contextmenu')
    expect(options).not.toHaveProperty('dropIntoEditor')
  })

  it('closes the paste side doors in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(optionsOf()).toMatchObject({ contextmenu: false, dropIntoEditor: { enabled: false }, pasteAs: { enabled: false }, dragAndDrop: false })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail** (when the user has said to run tests)

Run (from `apps/web`): `pnpm exec vitest run features/interview-live/work/editorIntegrity.test.ts features/interview-live/work/CodeEditor.options.test.tsx`
Expected: FAIL (module not found; no options on the editor).

- [ ] **Step 3: Write `editorIntegrity.ts`**

```ts
/**
 * Everything one Monaco editor needs for the live integrity rules (spec §6): options that remove features which insert text
 * for the candidate, the clipboard guard, how each edit arrived, and the typing cadence. Typed against the slice of Monaco
 * it uses, so tests drive it with fakes.
 */
import { createProvenance } from '../activity/provenance'
import { classifyKey, createCadence } from '../proctor/cadence'
import { attachEditorClipboard, type ClipboardEditor, type ForeignInsert } from '../proctor/editorClipboard'
import { clipboardRulesActive } from '../proctor/localClipboard'
import type { EditVia, WebMessageBody } from '../protocol/messages'

/** Always on, dev included: nothing in the editor completes or inserts text the candidate did not type. */
export const NO_ASSIST_OPTIONS = {
  quickSuggestions: false,
  suggestOnTriggerCharacters: false,
  acceptSuggestionOnEnter: 'off',
  tabCompletion: 'off',
  snippetSuggestions: 'none',
  wordBasedSuggestions: 'off',
  parameterHints: { enabled: false },
  inlineSuggest: { enabled: false },
} as const

/** While the clipboard rules are active: no context-menu paste, no drag-drop, "paste as" or drag-move in the editor. */
export const CLIPBOARD_RULE_OPTIONS = {
  contextmenu: false,
  dropIntoEditor: { enabled: false },
  pasteAs: { enabled: false },
  dragAndDrop: false,
} as const

export interface ContentChangeEvent {
  changes: readonly { range: { startLineNumber: number }; text: string }[]
  isFlush: boolean
  isUndoing?: boolean
  isRedoing?: boolean
}

export interface IntegrityEditor extends ClipboardEditor {
  getDomNode(): HTMLElement | null
  addCommand(keybinding: number, handler: () => void): string | null
  onDidChangeModelContent(cb: (e: ContentChangeEvent) => void): { dispose(): void }
}

export interface IntegrityMonaco {
  KeyCode: { F1: number; Space: number }
  KeyMod: { CtrlCmd: number }
}

export interface IntegrityDeps {
  send(body: WebMessageBody): void
  /** True while the interviewer's own edit is being applied (the code adapter's `isApplying`). */
  interviewerEditing(): boolean
  /** True while a change is the starter text being swapped in: not the candidate's, and not reported. */
  ignoring(): boolean
  onForeign(info: ForeignInsert): void
  now?(): number
}

export interface EditorIntegrity {
  /** How a change arrived; the code activity stream tags its edit events with it. */
  classify(change: { text: string }, event: { isUndoing?: boolean; isRedoing?: boolean }): EditVia
  dispose(): void
}

export function attachEditorIntegrity(editor: IntegrityEditor, monaco: IntegrityMonaco, deps: IntegrityDeps): EditorIntegrity {
  const now = deps.now ?? Date.now
  const provenance = createProvenance({ now, interviewerEditing: deps.interviewerEditing })
  const cadence = createCadence({ now, send: (window) => deps.send({ type: 'typing.window', ...window }) })
  const disposers: (() => void)[] = []

  // The command palette and a manual suggestion popup are other ways to get text into the editor that was not typed.
  editor.addCommand(monaco.KeyCode.F1, () => {})
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space, () => {})

  const host = editor.getDomNode()
  if (host) {
    if (clipboardRulesActive()) {
      disposers.push(attachEditorClipboard(host, editor, { asLocalPaste: provenance.asLocalPaste, onForeign: deps.onForeign }))
    }
    const onKeyDown = (e: Event) => {
      const k = e as KeyboardEvent
      provenance.keyPressed()
      if (k.repeat) return // a held key is auto-repeat, not a rhythm
      cadence.keyDown({ cls: classifyKey(k), at: now(), code: k.code, trusted: k.isTrusted })
    }
    const onKeyUp = (e: Event) => cadence.keyUp((e as KeyboardEvent).code)
    host.addEventListener('keydown', onKeyDown, true)
    host.addEventListener('keyup', onKeyUp, true)
    disposers.push(() => {
      host.removeEventListener('keydown', onKeyDown, true)
      host.removeEventListener('keyup', onKeyUp, true)
    })
  }

  const content = editor.onDidChangeModelContent((e) => {
    if (e.isFlush || deps.ignoring()) return
    for (const change of e.changes) {
      const via = provenance.classify({ text: change.text, isUndoing: e.isUndoing, isRedoing: e.isRedoing })
      cadence.inserted(change.text.length, via, change.range.startLineNumber)
    }
  })
  disposers.push(() => content.dispose())

  return {
    classify: (change, event) => provenance.classify({ text: change.text, isUndoing: event.isUndoing, isRedoing: event.isRedoing }),
    dispose() {
      disposers.forEach((d) => d())
      cadence.stop()
    },
  }
}
```

- [ ] **Step 4: Wire `CodeEditor.tsx`**

Add the imports (next to the existing `../activity/...` imports):

```tsx
import { clipboardRulesActive } from '../proctor/localClipboard'
import { useProctorActions } from '../proctor/ProctorContext'
import { CLIPBOARD_RULE_OPTIONS, NO_ASSIST_OPTIONS, attachEditorIntegrity, type EditorIntegrity, type IntegrityEditor, type IntegrityMonaco } from './editorIntegrity'
```

Inside `CodeEditor`, after `const starterSwap = …` add:

```tsx
  const { foreignPaste } = useProctorActions()
  const foreignRef = useRef(foreignPaste)
  const integrity = useRef<EditorIntegrity | null>(null)
  useEffect(() => { foreignRef.current = foreignPaste }, [foreignPaste])
```

Replace the unmount effect with:

```tsx
  useEffect(() => () => { registerCode(null); detachActivity.current?.(); integrity.current?.dispose() }, [registerCode])
```

Change `const onMount: OnMount = (editor) => {` to `const onMount: OnMount = (editor, monaco) => {` and replace the tail of `onMount` (from `registerCode(codeApi)` to the closing of the function):

```tsx
    registerCode(codeApi)
    integrity.current?.dispose()
    const guard = attachEditorIntegrity(editor as unknown as IntegrityEditor, monaco as unknown as IntegrityMonaco, {
      send: (body) => {
        try {
          session.send(body)
        } catch {
          // disconnected: this stretch of typing is simply lost, the round goes on
        }
      },
      interviewerEditing: () => codeApi.isApplying(),
      ignoring: () => starterSwap.current.matches(editor.getModel()?.getValue() ?? ''),
      onForeign: (info) => foreignRef.current(info),
    })
    integrity.current = guard
    detachActivity.current?.()
    detachActivity.current = attachCodeActivity(
      editor as unknown as ActivityEditor,
      record,
      () => codeApi.isApplying() || starterSwap.current.matches(editor.getModel()?.getValue() ?? ''),
      guard.classify,
    )
  }
```

Replace the `options` prop of `<Editor>`:

```tsx
          options={{
            minimap: { enabled: false }, fontSize: 14, automaticLayout: true, scrollBeyondLastLine: false, padding: { top: 12 }, glyphMargin: true,
            ...NO_ASSIST_OPTIONS,
            ...(clipboardRulesActive() ? CLIPBOARD_RULE_OPTIONS : {}),
          }}
```

Update the component's doc comment: append "It also tags how each edit arrived, reports typing cadence, and, in production, keeps copy and paste inside the room (live integrity spec §6)."

- [ ] **Step 5: Run the tests to verify they pass** (when the user has said to run tests)

Run (from `apps/web`): `pnpm exec vitest run features/interview-live/work features/interview-live/activity features/interview-live/proctor`
Expected: PASS, including the existing `CodeEditor`, `codeApi` and `WorkArea` tests.

- [ ] **Step 6: Leave the files in the working tree** (no commit): `editorIntegrity.ts`, `CodeEditor.tsx`, the two new test files.

---

### Task 9: Clear the clipboard at Join, and say the rules

**Files:**
- Modify: `apps/web/app/(app)/interviews/[sessionId]/live/_components/ChecksView.tsx`, `PrejoinView.tsx`
- Test: `ChecksView.test.tsx`, `PrejoinView.test.tsx` (create), same folder

**Interfaces:**
- Consumes: `clearSystemClipboard`, `wasCleared`, `resetClipboard` (Task 2).

- [ ] **Step 1: Write the failing tests**

Add to the imports of `ChecksView.test.tsx`:

```tsx
import { resetClipboard, wasCleared } from "@/features/interview-live/proctor/localClipboard";
```

Append inside `describe("ChecksView", …)`:

```tsx
  it("Enter interview clears the clipboard once, with the click, while the clipboard rules are active", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    try {
      const user = await renderAtChecks(new MockLiveSession());
      mockEntireScreen();
      await user.click(screen.getByRole("button", { name: "Share entire screen" }));
      const enterButton = await screen.findByRole("button", { name: /enter interview/i });
      await waitFor(() => expect(enterButton).toBeEnabled());
      await user.click(enterButton);
      await waitFor(() => expect(screen.getByTestId("fsm-state").textContent).toBe("live"));
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText).toHaveBeenCalledWith("IQ-ROOM-CLIPBOARD");
      expect(wasCleared()).toBe(true);
    } finally {
      resetClipboard();
      Reflect.deleteProperty(navigator, "clipboard");
      vi.unstubAllEnvs();
    }
  });

  it("Enter interview still goes live when the clipboard cannot be cleared", async () => {
    vi.stubEnv("NODE_ENV", "production");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async () => { throw new Error("denied"); }) } });
    try {
      const user = await renderAtChecks(new MockLiveSession());
      mockEntireScreen();
      await user.click(screen.getByRole("button", { name: "Share entire screen" }));
      const enterButton = await screen.findByRole("button", { name: /enter interview/i });
      await waitFor(() => expect(enterButton).toBeEnabled());
      await user.click(enterButton);
      await waitFor(() => expect(screen.getByTestId("fsm-state").textContent).toBe("live"));
      expect(wasCleared()).toBe(false);
    } finally {
      resetClipboard();
      Reflect.deleteProperty(navigator, "clipboard");
      vi.unstubAllEnvs();
    }
  });

  it("tells the candidate the clipboard is cleared on entering", async () => {
    await renderAtChecks(new MockLiveSession());
    expect(screen.getByText(/clears your clipboard/i)).toBeInTheDocument();
  });
```

Create `PrejoinView.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LiveSessionProvider } from "@/features/interview-live/session/LiveSessionProvider";
import { MockLiveSession } from "@/features/interview-live/session/MockLiveSession";
import { PrejoinView } from "./PrejoinView";

describe("PrejoinView rules", () => {
  it("states the return time, paste and typing rules before the candidate agrees", () => {
    render(
      <LiveSessionProvider sessionId="s1" session={new MockLiveSession()}>
        <PrejoinView />
      </LiveSessionProvider>,
    );
    expect(screen.getByText(/come back within 15 seconds/)).toBeInTheDocument();
    expect(screen.getByText(/after 60 seconds the interview ends/)).toBeInTheDocument();
    expect(screen.getByText(/pasting outside text ends the interview/)).toBeInTheDocument();
    expect(screen.getByText(/automated typing ends the interview/)).toBeInTheDocument();
    expect(screen.getByLabelText(/pasting text from outside the room or typing by script ends the interview/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail** (when the user has said to run tests)

Run (from `apps/web`): `pnpm exec vitest run "app/(app)/interviews/[sessionId]/live/_components/ChecksView.test.tsx" "app/(app)/interviews/[sessionId]/live/_components/PrejoinView.test.tsx"`
Expected: FAIL (no clipboard write; the copy is not there).

- [ ] **Step 3: Clear the clipboard in `ChecksView.tsx`**

Add the import next to the other `@/features/interview-live/proctor/…` imports:

```tsx
import { clearSystemClipboard } from "@/features/interview-live/proctor/localClipboard";
```

Replace the start of `handleEnter`:

```tsx
  async function handleEnter() {
    setEntering(true);
    // Clearing the clipboard needs this click's user gesture, so it starts before anything is awaited. It never rejects: a
    // refusal is recorded, and the worker then treats a foreign paste as a violation rather than an ending.
    const clearing = clearSystemClipboard();
    try {
      await enterFullscreen();
    } catch {
      setEntering(false);
      return;
    }
    await clearing;
```

(the rest of `handleEnter` is unchanged). Change the intro paragraph to: "We run a quick check before entering the interview. Entering switches to full screen and clears your clipboard. Switching tabs, windows or screens is counted, and the interviewer will mention it."

- [ ] **Step 4: Say the rules in `PrejoinView.tsx`**

Replace `DONTS` with:

```tsx
const DONTS = [
  "Don't switch tabs, windows or screens. Every switch is counted, and repeated switches end the round.",
  "If you do leave this screen or full screen, come back within 15 seconds (30 for full screen or screen share). After that it counts as another violation, and after 60 seconds the interview ends.",
  "Don't paste text from anywhere else. Copy and paste work only inside this room, your clipboard is cleared when you join, and pasting outside text ends the interview.",
  "Don't use automated typing or scripts. Your code must be typed by you, and automated typing ends the interview.",
  "Don't use a phone, second monitor, or another person for help.",
  "Don't refresh or close this tab once the interview has started.",
];
```

In the notice paragraph, replace the sentence ending "…only short summaries of them." with: "…only short summaries of them. The interviewer also notices how you type, such as how steadily and whether text appears without typing, but never which keys you press."

Replace the agreement label text with:

```tsx
              I understand the interview runs in full screen with my entire
              screen shared, that the interviewer sees my cursor, typing and
              drawing, that switching tabs or screens is counted and can end
              the round, that pasting text from outside the room or typing by
              script ends the interview, that my clipboard is cleared when I
              join, and I agree to the rules above.
```

- [ ] **Step 5: Run the tests to verify they pass** (when the user has said to run tests)

Run (from `apps/web`): `pnpm exec vitest run "app/(app)/interviews/[sessionId]/live"`
Expected: PASS (the existing checks, prejoin gating and live tests too).

- [ ] **Step 6: Leave the files in the working tree** (no commit): `ChecksView.tsx`, `PrejoinView.tsx`, `ChecksView.test.tsx`, `PrejoinView.test.tsx`.

---

### Task 10: Verify in a real browser (the user)

Unit tests cannot prove Monaco's clipboard mechanics, which differ by browser (spec §13). This is the probe the spec calls for; the user runs it, the executing agent prepares it and reports the result.

**Files:** none (fixes, if any, go in `proctor/editorClipboard.ts`).

- [ ] **Step 1: Run the room with the rules on**

From `apps/web`: `NEXT_PUBLIC_LIVE_MOCK=1 NEXT_PUBLIC_ENFORCE_CLIPBOARD=1 pnpm dev`, then open `/interviews/<any-id>/live` while signed in. (Mock mode needs no API, LiveKit or AI service; the scripted interviewer ends the round on a foreign paste.) Use Chrome first; Firefox and Safari after.

- [ ] **Step 2: Walk this checklist and record what happens**

| # | Action | Expected |
|---|---|---|
| 1 | Type code; Ctrl+C a selection; Ctrl+V | The selection is pasted. Nothing else happens. |
| 2 | Ctrl+C with nothing selected, then Ctrl+V on another line | The whole line is pasted on a line of its own. |
| 3 | Ctrl+X a selection, then Ctrl+Z | The text goes, then comes back. |
| 4 | After step 1, paste into a plain text field outside the room (the browser's address bar) | It shows `IQ-ROOM-CLIPBOARD`, not your code. |
| 5 | Copy text from another tab or app, return, Ctrl+V in the editor | Nothing is inserted; the toast says pasting is blocked; the scripted interviewer ends the round. |
| 6 | Same, from the right-click menu | There is no context menu. |
| 7 | Press F1 and Ctrl/Cmd+Space | Nothing opens. |
| 8 | Drag selected text from another window into the editor | Not allowed; ends the round as a foreign drop. |
| 9 | Refresh the page mid-round, re-enter, then Ctrl+V with nothing copied since | Nothing happens (no ending). |
| 10 | Copy from the problem panel, paste into the editor | It pastes (it is in the room). |
| 11 | Leave full screen and wait | A bar counts down from 30 s, then to the end of the interview; the tab title shows the countdown from another tab. Return within the limit: no toast. Return after it: the toast says it counts as an extra violation. |
| 12 | Open the browser console; `typing.window` messages appear in the mock session's `sent` list while typing (or check the network panel for the room's data messages with a real session) | One about every 5 s while typing; none while idle. |

- [ ] **Step 3: If `Ctrl+V` of a local copy inserts nothing (step 1 or 2)**

`editor.trigger('room-clipboard', 'paste', …)` is the intended insertion. If this Monaco build ignores it, replace the `deps.asLocalPaste(() => editor.trigger(…))` call in `onPaste` with a direct edit and re-run steps 1 and 2:

```ts
      deps.asLocalPaste(() => {
        const text = getBuffer()
        editor.pushUndoStop()
        editor.executeEdits('room-paste', (editor.getSelections() ?? []).map((range) => ({ range, text })))
        editor.pushUndoStop()
      })
```

Update the matching assertions in `editorClipboard.test.ts` (`executeEdits` called with `'room-paste'` instead of `trigger`).

- [ ] **Step 4: Report** which rows passed in which browser, and anything that differed. Do not change thresholds or copy in this task.

---

## Not in this plan

Phase 2 (the worker: `integrity.py` `assess_typing`, `AwayWatch`, `on_integrity`, the orders and prompts, the `foreign_paste` kind in the Python protocol, summary fields, simulator commands, threshold calibration) and Phase 3 (the API `LiveSummary` fields) are separate plans, written once this phase lands, because they depend on the message shapes fixed here and on the worker being free of prep runs and other agents' edits. Until then an updated worker accepts and ignores the three new messages, and drops a `foreign_paste` event; the browser still blocks the paste.
