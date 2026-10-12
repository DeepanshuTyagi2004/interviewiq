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
