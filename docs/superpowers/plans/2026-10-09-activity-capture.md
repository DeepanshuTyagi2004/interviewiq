# Live activity capture (browser) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The browser reports what the candidate types, draws and points at (editor, whiteboard, problem panel) to the interviewer as small timestamped `activity.batch` messages, and the instruction page tells the candidate this happens.

**Architecture:** A new web → agent message, `activity.batch`, carries up to 60 events. Pure adapters turn Monaco, Excalidraw and DOM events into event bodies; an `ActivityBatcher` stamps, de-duplicates, merges, caps and flushes them every 500 ms through the existing `LiveSession.send`. An `ActivityProvider` in the live room gives every pane a `record()`. The worker ignores unknown messages today, so this plan ships safely before plan 2.

**Tech Stack:** TypeScript, React 19, Zod 4, Vitest (+ Testing Library), Monaco (`@monaco-editor/react`), Excalidraw 0.18, Pydantic (the Python mirror of the protocol).

**Spec:** `docs/superpowers/specs/2026-10-09-live-activity-awareness-design.md` (§5, §10, §11 browser items). It extends `docs/superpowers/specs/2026-10-08-live-interviewer-design.md`.

## Global Constraints

- Only the editor, the whiteboard and the problem panel are observed. Nothing outside them is captured.
- Pointer events only when the target changes; Edits merge within 300 ms on the same line; shapes at most one event per element and operation per 500 ms.
- Batches flush every 500 ms when non-empty: **at most 2 batches a second, 60 events and 4 KB each**. Over the cap, the oldest pointer events go first.
- String caps: code line text ≤ 80, inserted text ≤ 200, selected text ≤ 120, panel quote ≤ 120, shape label and `over` ≤ 60.
- Capture runs only while the live room is mounted (machine state `live` or `reconnecting`).
- Disclosure copy: "While you work, the interviewer sees your cursor, what you type and draw, and what you say as you do it. Only short summaries of this are kept for your debrief." and the agreement text gains "that the interviewer sees my cursor, typing and drawing,".
- Resume spelling "resume"; no scores; orange `brand` is the only accent; match existing HUD classes.
- Web code: Server Components by default, `"use client"` where interactive; Tailwind 3.x; no new dependencies.
- The user commits. **Never `git commit`.** Run tests from `apps/web` with `pnpm exec vitest run <path>` and from `apps/ai-service` with `.venv/bin/python -m pytest <path>`.

## Rulings carried into this plan

- Wire field names are `from_line`, `to_line`, `removed` (not `from`, `to`, `del`: `from` and `del` are Python keywords, which would force aliases in the Pydantic mirror). Task 1 updates the spec table.
- Pointer de-duplication and the 250 ms limit are **global**, not per surface: moving code → panel → code on the same line must still report the return to the code line, which per-surface de-duplication would swallow.
- Pointer samples can be emitted out of time order (a held-back sample is sent at the next flush). The worker sorts by `t`; the browser does not.

## Review Focus

Input classes the spec implies and the tasks must pin with tests:

1. **The interviewer's own edits and shapes are not the candidate's activity.** Its `executeEdits` comments/inserts (Monaco `isApplying()`), and shapes it drew (`customData.author === "interviewer"`), must never be reported. (Task 4, Task 5)
2. **Programmatic replacements.** A language switch or a restore calls `setValue` (Monaco `isFlush`), and a restore swaps the whole Excalidraw scene: neither is typing nor drawing. (Task 4, Task 5)
3. **Pointer floods.** 1000 pointer moves in a second must not exceed the batch caps, and the final pointer position must not be lost. (Task 2)
4. **Capture after the room is gone, or while disconnected.** Nothing is sent after unmount, and a `send` that throws is swallowed. (Task 2, Task 3)
5. **Huge pastes and long labels.** `ins`, labels, quotes and line text are capped; one batch never exceeds 4 KB. (Task 2, Task 4, Task 6)

---

## File Structure

**Create**
- `apps/web/features/interview-live/activity/batcher.ts`: `ActivityBatcher`, `trimBatch`, limits.
- `apps/web/features/interview-live/activity/ActivityProvider.tsx`: provider, `useActivity`, `ActivityPane`.
- `apps/web/features/interview-live/activity/codeActivity.ts`: Monaco → events, `attachCodeActivity`.
- `apps/web/features/interview-live/activity/boardActivity.ts`: `hitTest`, `shapeEvents`.
- `apps/web/features/interview-live/activity/panelActivity.ts`: `quoteFromText`, `quoteAtPoint`.
- One `*.test.ts(x)` next to each.

**Modify**
- `apps/web/features/interview-live/protocol/messages.ts`: `ActivityEvent`, `ActivityBatch`, export `DistributiveOmit`.
- `packages/contracts/live-workspace.examples.json`, `packages/contracts/live-workspace.schema.json` (generated).
- `apps/ai-service/app/interviewer/protocol.py`, `apps/ai-service/tests/interviewer/test_protocol.py`: the Pydantic mirror.
- `apps/web/features/interview-live/workspace/board.ts`: export `coverOf`.
- `apps/web/features/interview-live/work/CodeEditor.tsx`, `DiagramBoard.tsx`, `WorkArea.tsx`; `panel/ProblemPanel.tsx`.
- `apps/web/app/(app)/interviews/[sessionId]/live/_components/LiveView.tsx`, `PrejoinView.tsx` (+ their tests).
- `apps/web/features/interview-live/session/ScriptedLiveSession.ts`: a debug log for the mock room.
- `docs/superpowers/specs/2026-10-09-live-activity-awareness-design.md`: field names in the §5.1 table.

---

### Task 1: The `activity.batch` message on both sides

**Files:**
- Modify: `apps/web/features/interview-live/protocol/messages.ts`
- Modify: `packages/contracts/live-workspace.examples.json`
- Generate: `packages/contracts/live-workspace.schema.json`
- Modify: `apps/ai-service/app/interviewer/protocol.py`
- Modify: `docs/superpowers/specs/2026-10-09-live-activity-awareness-design.md`
- Test: `apps/web/features/interview-live/protocol/messages.test.ts`, `apps/ai-service/tests/interviewer/test_protocol.py`

**Interfaces:**
- Produces (TS): `ActivityEvent` (Zod union + type), `ActivityBatch` (Zod object, `type: 'activity.batch'`, `sent_at`, `events`), `ACTIVITY_MAX_EVENTS = 60`, exported type `DistributiveOmit`, and `export type ActivityEventBody = DistributiveOmit<ActivityEvent, 't'>`. `WebMessage` now includes `ActivityBatch`, so `session.send({ type: 'activity.batch', sent_at, events })` type-checks.
- Produces (Python): `ActivityBatch` model in `_WEB_MODELS`, `ActivityEvent` union (`PtrCode`, `PtrBoard`, `PtrPanel`, `PtrOut`, `Caret`, `Edit`, `Shape`, `Focus`). Plan 2 consumes `ActivityBatch.sent_at: int` and `ActivityBatch.events`.

- [ ] **Step 1: Write the failing web tests**

Append to the `describe('workspace protocol', …)` block in `messages.test.ts`, before the closing `})`:

```ts
  it('accepts a mixed activity batch and rejects oversized, malformed and unknown events', () => {
    const ok = examples['activity.batch'] as Record<string, unknown>
    expect(WebMessage.safeParse(ok).success).toBe(true)
    const out = { k: 'ptr', t: 1, s: 'out' }
    const bad = (events: unknown[]) => WebMessage.safeParse({ ...ok, events }).success
    expect(bad([])).toBe(false)
    expect(bad(Array(61).fill(out))).toBe(false)
    expect(bad([{ k: 'ptr', t: 1, s: 'code', line: 0, col: 1, text: '' }])).toBe(false)
    expect(bad([{ k: 'edit', t: 1, from_line: 1, to_line: 1, ins: 'x'.repeat(201), removed: 0 }])).toBe(false)
    expect(bad([{ k: 'shape', t: 1, op: 'teleport', id: 'a', kind: 'rectangle' }])).toBe(false)
    expect(bad([{ k: 'teleport', t: 1 }])).toBe(false)
    expect(bad([out])).toBe(true)
  })
```

- [ ] **Step 2: Run to verify it fails**

Run (from `apps/web`): `pnpm exec vitest run features/interview-live/protocol/messages.test.ts`
Expected: FAIL (`examples['activity.batch']` is undefined, so `safeParse(undefined)` is false).

- [ ] **Step 3: Add the Zod schemas**

In `messages.ts`, change `type DistributiveOmit` to an exported type, and add the activity schemas just above `export const WebMessage = …`:

```ts
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
```

```ts
// ---------------------------------------------------------------- activity (web → agent)

/** Most events one batch may carry. */
export const ACTIVITY_MAX_EVENTS = 60
const At = z.number().int().min(0)
const Col = z.number().int().min(1)
const PtrCode = z.object({ k: z.literal('ptr'), t: At, s: z.literal('code'), line: Line, col: Col, text: z.string().max(80) })
const PtrBoard = z.object({ k: z.literal('ptr'), t: At, s: z.literal('board'), x: z.number(), y: z.number(), over: z.string().max(60).optional() })
const PtrPanel = z.object({ k: z.literal('ptr'), t: At, s: z.literal('panel'), quote: z.string().max(120) })
const PtrOut = z.object({ k: z.literal('ptr'), t: At, s: z.literal('out') })
const Caret = z.object({
  k: z.literal('caret'), t: At, line: Line, col: Col, sel: z.tuple([Line, Line]).optional(), text: z.string().max(120).optional(),
})
const Edit = z.object({
  k: z.literal('edit'), t: At, from_line: Line, to_line: Line, ins: z.string().max(200), removed: z.number().int().min(0),
})
const Shape = z.object({
  k: z.literal('shape'), t: At, op: z.enum(['add', 'move', 'edit', 'delete']), id: Id, kind: z.string().min(1).max(30), label: z.string().max(60).optional(),
})
const Focus = z.object({ k: z.literal('focus'), t: At, s: z.enum(['code', 'board', 'panel']) })
/** One thing the candidate did in the workspace; `t` is browser epoch milliseconds. */
export const ActivityEvent = z.union([PtrCode, PtrBoard, PtrPanel, PtrOut, Caret, Edit, Shape, Focus])
export const ActivityBatch = z.object({
  ...header, type: z.literal('activity.batch'), sent_at: At, events: z.array(ActivityEvent).min(1).max(ACTIVITY_MAX_EVENTS),
})
```

Add `ActivityBatch` to the `WebMessage` union (`… ProctorEventMessage, Hello, EndRequest, ActivityBatch,`), and below the other type exports add:

```ts
export type ActivityEvent = z.infer<typeof ActivityEvent>
/** An activity event before the batcher stamps `t`. */
export type ActivityEventBody = DistributiveOmit<ActivityEvent, 't'>
```

- [ ] **Step 4: Add the shared example, regenerate the schema**

Add this entry at the end of `packages/contracts/live-workspace.examples.json` (after `"session.end_request"`; mind the comma):

```json
  "activity.batch": {
    "v": 1,
    "id": "w_activity_1",
    "type": "activity.batch",
    "sent_at": 1760000001000,
    "events": [
      { "k": "focus", "t": 1760000000100, "s": "code" },
      { "k": "edit", "t": 1760000000200, "from_line": 3, "to_line": 3, "ins": "for i in range(n):", "removed": 0 },
      { "k": "caret", "t": 1760000000300, "line": 3, "col": 19 },
      { "k": "caret", "t": 1760000000350, "line": 3, "col": 5, "sel": [3, 4], "text": "for i in range(n):" },
      { "k": "ptr", "t": 1760000000400, "s": "code", "line": 3, "col": 5, "text": "for i in range(n):" },
      { "k": "ptr", "t": 1760000000500, "s": "board", "x": 120.5, "y": 80, "over": "cache" },
      { "k": "ptr", "t": 1760000000600, "s": "panel", "quote": "at most two distinct characters" },
      { "k": "shape", "t": 1760000000700, "op": "add", "id": "abc", "kind": "rectangle", "label": "cache" },
      { "k": "ptr", "t": 1760000000800, "s": "out" }
    ]
  }
```

Run (from `apps/web`): `pnpm generate:live-schema`
Expected: prints `wrote …/packages/contracts/live-workspace.schema.json`.

- [ ] **Step 5: Run the web tests**

Run: `pnpm exec vitest run features/interview-live/protocol/messages.test.ts`
Expected: PASS (every example is valid, the example set matches the protocol, the committed schema equals the generated one).

- [ ] **Step 6: Write the failing Python test**

Append to `apps/ai-service/tests/interviewer/test_protocol.py`:

```python


def test_activity_batches_reject_oversized_malformed_and_unknown_events():
    ok = EXAMPLES["activity.batch"]
    parsed = parse_web(json.dumps(ok))
    assert parsed is not None and parsed.type == "activity.batch" and parsed.sent_at == 1760000001000
    assert parsed.events[1].from_line == 3 and parsed.events[1].removed == 0
    out = {"k": "ptr", "t": 1, "s": "out"}
    bad = [
        [],
        [out] * 61,
        [{"k": "ptr", "t": 1, "s": "code", "line": 0, "col": 1, "text": ""}],
        [{"k": "edit", "t": 1, "from_line": 1, "to_line": 1, "ins": "x" * 201, "removed": 0}],
        [{"k": "shape", "t": 1, "op": "teleport", "id": "a", "kind": "rectangle"}],
        [{"k": "teleport", "t": 1}],
    ]
    for events in bad:
        assert parse_web(json.dumps({**ok, "events": events})) is None
    assert parse_web(json.dumps({**ok, "events": [out]})) is not None
```

- [ ] **Step 7: Run to verify it fails**

Run (from `apps/ai-service`): `.venv/bin/python -m pytest tests/interviewer/test_protocol.py -q`
Expected: FAIL (`activity.batch` is not a web type; `test_examples_cover_exactly_the_protocol` fails too).

- [ ] **Step 8: Add the Pydantic mirror**

In `protocol.py`, above `_WEB_MODELS`, add:

```python
class _Event(_M):
    t: int = Field(ge=0)


class PtrCode(_Event):
    k: Literal["ptr"]
    s: Literal["code"]
    line: Line
    col: Annotated[int, Field(ge=1)]
    text: str = Field(max_length=80)


class PtrBoard(_Event):
    k: Literal["ptr"]
    s: Literal["board"]
    x: float
    y: float
    over: str | None = Field(None, max_length=60)


class PtrPanel(_Event):
    k: Literal["ptr"]
    s: Literal["panel"]
    quote: str = Field(max_length=120)


class PtrOut(_Event):
    k: Literal["ptr"]
    s: Literal["out"]


class Caret(_Event):
    k: Literal["caret"]
    line: Line
    col: Annotated[int, Field(ge=1)]
    sel: tuple[Line, Line] | None = None
    text: str | None = Field(None, max_length=120)


class Edit(_Event):
    k: Literal["edit"]
    from_line: Line
    to_line: Line
    ins: str = Field(max_length=200)
    removed: int = Field(ge=0)


class Shape(_Event):
    k: Literal["shape"]
    op: Literal["add", "move", "edit", "delete"]
    id: Id
    kind: str = Field(min_length=1, max_length=30)
    label: str | None = Field(None, max_length=60)


class Focus(_Event):
    k: Literal["focus"]
    s: Literal["code", "board", "panel"]


ActivityEvent = Union[PtrCode, PtrBoard, PtrPanel, PtrOut, Caret, Edit, Shape, Focus]
ACTIVITY_MAX_EVENTS = 60


class ActivityBatch(_Msg):
    type: Literal["activity.batch"]
    sent_at: int = Field(ge=0)
    events: list[ActivityEvent] = Field(min_length=1, max_length=ACTIVITY_MAX_EVENTS)


```

and add `ActivityBatch` to `_WEB_MODELS`:

```python
_WEB_MODELS = (Ack, SectionAdded, HighlightAdded, CodeHighlightAdded, AskSelection, CodeSnapshot, BoardSummary,
               ProctorEventMessage, Hello, EndRequest, ActivityBatch)
```

- [ ] **Step 9: Run the Python tests**

Run: `.venv/bin/python -m pytest tests/interviewer/test_protocol.py -q`
Expected: PASS (all parametrised examples, including `activity.batch`).

- [ ] **Step 10: Update the spec table**

In `docs/superpowers/specs/2026-10-09-live-activity-awareness-design.md` §5.1, change the `edit` row's fields to ``from_line`, `to_line` (lines, before the change), `ins` (inserted text, ≤ 200), `removed` (characters removed)``. Change nothing else.

- [ ] **Step 11: Whole-protocol check, no commit**

Run (from `apps/web`): `pnpm exec tsc --noEmit` — Expected: no output.
Run (from `apps/ai-service`): `.venv/bin/python -m pytest tests/interviewer -q` — Expected: all pass.
Do not commit (standing preference).

---

### Task 2: `ActivityBatcher`

**Files:**
- Create: `apps/web/features/interview-live/activity/batcher.ts`
- Test: `apps/web/features/interview-live/activity/batcher.test.ts`

**Interfaces:**
- Consumes: `ActivityEvent`, `ActivityEventBody`, `ACTIVITY_MAX_EVENTS` from `../protocol/messages`.
- Produces:
  - `export interface BatchOut { sent_at: number; events: ActivityEvent[] }`
  - `export interface BatcherDeps { now(): number; send(batch: BatchOut): void }`
  - `export class ActivityBatcher { constructor(deps: BatcherDeps); record(body: ActivityEventBody): void; flush(): void; start(): void; stop(): void }`
  - `export function trimBatch(events: ActivityEvent[]): ActivityEvent[]`
  - constants `FLUSH_MS = 500`, `POINTER_MIN_GAP_MS = 250`, `EDIT_MERGE_MS = 300`, `SHAPE_MIN_GAP_MS = 500`, `MAX_BATCH_BYTES = 4096`, `MAX_INS = 200`.

- [ ] **Step 1: Write the failing tests**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActivityEventBody } from '../protocol/messages'
import { ActivityBatcher, FLUSH_MS, MAX_BATCH_BYTES, trimBatch, type BatchOut } from './batcher'

let sent: BatchOut[]
let batcher: ActivityBatcher

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
  sent = []
  batcher = new ActivityBatcher({ now: () => Date.now(), send: (b) => sent.push(b) })
})
afterEach(() => {
  batcher.stop()
  vi.useRealTimers()
})

const code = (line: number): ActivityEventBody => ({ k: 'ptr', s: 'code', line, col: 1, text: `line ${line}` })
const edit = (line: number, ins: string): ActivityEventBody => ({ k: 'edit', from_line: line, to_line: line, ins, removed: 0 })
const lines = (b: BatchOut) => b.events.filter((e) => e.k === 'ptr').map((e) => (e.k === 'ptr' && e.s === 'code' ? e.line : -1))

describe('ActivityBatcher', () => {
  it('stamps each event and sends one batch when the flush timer fires', () => {
    batcher.record({ k: 'focus', s: 'code' })
    vi.advanceTimersByTime(200)
    batcher.record({ k: 'caret', line: 2, col: 3 })
    expect(sent).toHaveLength(0)
    vi.advanceTimersByTime(FLUSH_MS)
    expect(sent).toHaveLength(1)
    expect(sent[0].sent_at).toBe(1_000_000 + FLUSH_MS)
    expect(sent[0].events).toEqual([{ k: 'focus', s: 'code', t: 1_000_000 }, { k: 'caret', line: 2, col: 3, t: 1_000_200 }])
  })

  it('sends nothing when nothing happened', () => {
    vi.advanceTimersByTime(5000)
    batcher.flush()
    expect(sent).toHaveLength(0)
  })

  it('drops a pointer sample on the target it already reported', () => {
    batcher.record(code(4))
    vi.advanceTimersByTime(300)
    batcher.record(code(4))
    vi.advanceTimersByTime(FLUSH_MS)
    expect(sent.flatMap(lines)).toEqual([4])
  })

  it('limits pointer changes to one per 250 ms and still reports where it ended up', () => {
    batcher.record(code(1))
    vi.advanceTimersByTime(100)
    batcher.record(code(2))
    vi.advanceTimersByTime(100)
    batcher.record(code(3))
    vi.advanceTimersByTime(FLUSH_MS)
    expect(sent.flatMap(lines)).toEqual([1, 3])
  })

  it('reports a return to a line it left through another surface', () => {
    batcher.record(code(5))
    vi.advanceTimersByTime(300)
    batcher.record({ k: 'ptr', s: 'panel', quote: 'the statement' })
    vi.advanceTimersByTime(300)
    batcher.record(code(5))
    vi.advanceTimersByTime(FLUSH_MS)
    const kinds = sent.flatMap((b) => b.events).map((e) => (e.k === 'ptr' ? e.s : e.k))
    expect(kinds).toEqual(['code', 'panel', 'code'])
  })

  it('survives a flood: 1000 pointer moves in a second send a few events and the final target', () => {
    for (let i = 0; i < 1000; i++) {
      batcher.record(code((i % 50) + 1))
      vi.advanceTimersByTime(1)
    }
    vi.advanceTimersByTime(FLUSH_MS)
    const events = sent.flatMap((b) => b.events)
    expect(sent.length).toBeLessThanOrEqual(3)
    expect(events.length).toBeLessThanOrEqual(10)
    expect(lines({ sent_at: 0, events }).at(-1)).toBe(((999) % 50) + 1)
    for (const b of sent) expect(JSON.stringify(b.events).length).toBeLessThanOrEqual(MAX_BATCH_BYTES)
  })

  it('merges quick edits on one line, keeps a new line separate and caps what was inserted', () => {
    batcher.record(edit(1, 'a'))
    vi.advanceTimersByTime(100)
    batcher.record(edit(1, 'b'))
    vi.advanceTimersByTime(100)
    batcher.record(edit(2, 'c'))
    vi.advanceTimersByTime(400)
    batcher.record(edit(2, 'd'))
    vi.advanceTimersByTime(FLUSH_MS)
    const edits = sent.flatMap((b) => b.events).filter((e) => e.k === 'edit')
    expect(edits.map((e) => (e.k === 'edit' ? [e.from_line, e.ins] : []))).toEqual([[1, 'ab'], [2, 'c'], [2, 'd']])
    batcher.record(edit(9, 'x'.repeat(150)))
    batcher.record(edit(9, 'y'.repeat(150)))
    batcher.flush()
    const merged = sent.at(-1)!.events[0]
    expect(merged.k === 'edit' && merged.ins.length).toBe(200)
  })

  it('reports a shape once per half second per element and operation', () => {
    const shape = (op: 'add' | 'move'): ActivityEventBody => ({ k: 'shape', op, id: 'a', kind: 'rectangle', label: 'cache' })
    batcher.record(shape('add'))
    vi.advanceTimersByTime(100)
    batcher.record(shape('add'))
    batcher.record(shape('move'))
    batcher.flush()
    expect(sent.flatMap((b) => b.events).map((e) => (e.k === 'shape' ? e.op : e.k))).toEqual(['add', 'move'])
    vi.advanceTimersByTime(600)
    batcher.record(shape('move'))
    batcher.flush()
    expect(sent.at(-1)!.events).toHaveLength(1)
  })

  it('sends nothing after stop and works again after start', () => {
    batcher.stop()
    batcher.record({ k: 'focus', s: 'board' })
    vi.advanceTimersByTime(FLUSH_MS * 2)
    expect(sent).toHaveLength(0)
    batcher.start()
    batcher.record({ k: 'focus', s: 'board' })
    vi.advanceTimersByTime(FLUSH_MS)
    expect(sent).toHaveLength(1)
  })
})

describe('trimBatch', () => {
  const at = (i: number) => ({ t: i })
  it('keeps at most 60 events, dropping pointer samples before anything else, then the oldest', () => {
    const events = [
      ...Array.from({ length: 5 }, (_, i) => ({ k: 'ptr' as const, s: 'out' as const, ...at(i) })),
      ...Array.from({ length: 70 }, (_, i) => ({ k: 'focus' as const, s: 'code' as const, ...at(10 + i) })),
    ]
    const out = trimBatch(events)
    expect(out).toHaveLength(60)
    expect(out.some((e) => e.k === 'ptr')).toBe(false)
    expect(out[0].t).toBe(20) // the ten oldest focus events went too
  })

  it('keeps a batch under 4 KB', () => {
    const big = Array.from({ length: 30 }, (_, i) => ({ k: 'edit' as const, from_line: i + 1, to_line: i + 1, ins: 'z'.repeat(200), removed: 0, ...at(i) }))
    expect(JSON.stringify(trimBatch(big)).length).toBeLessThanOrEqual(MAX_BATCH_BYTES)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run (from `apps/web`): `pnpm exec vitest run features/interview-live/activity/batcher.test.ts`
Expected: FAIL ("Failed to resolve import ./batcher").

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Turns the room's activity into `activity.batch` messages (spec §5.2): stamps each event, drops repeats
 * (a pointer that has not moved to a new target), merges keystrokes, throttles shape changes, and flushes
 * every 500 ms within the 60-event / 4 KB caps. Pure of React and the session: the room wires it up.
 */
import { ACTIVITY_MAX_EVENTS, type ActivityEvent, type ActivityEventBody } from '../protocol/messages'

export const FLUSH_MS = 500
export const POINTER_MIN_GAP_MS = 250
export const EDIT_MERGE_MS = 300
export const SHAPE_MIN_GAP_MS = 500
export const MAX_BATCH_BYTES = 4096
export const MAX_INS = 200
const BOARD_CELL = 120
const MAX_TRACKED_SHAPES = 500

export interface BatchOut {
  sent_at: number
  events: ActivityEvent[]
}

export interface BatcherDeps {
  now(): number
  send(batch: BatchOut): void
}

type Pointer = Extract<ActivityEvent, { k: 'ptr' }>

/** What a pointer event is resting on; a new key is a new target. */
function targetKey(e: Pointer): string {
  switch (e.s) {
    case 'code': return `code:${e.line}`
    case 'board': return `board:${e.over ?? `${Math.floor(e.x / BOARD_CELL)},${Math.floor(e.y / BOARD_CELL)}`}`
    case 'panel': return `panel:${e.quote}`
    case 'out': return 'out'
  }
}

/** At most 60 events and 4 KB: the oldest pointer samples go first, then the oldest events. */
export function trimBatch(events: ActivityEvent[]): ActivityEvent[] {
  const out = [...events]
  const size = () => JSON.stringify(out).length
  while (out.length > ACTIVITY_MAX_EVENTS || size() > MAX_BATCH_BYTES) {
    const i = out.findIndex((e) => e.k === 'ptr')
    out.splice(i === -1 ? 0 : i, 1)
  }
  return out
}

export class ActivityBatcher {
  private buffer: ActivityEvent[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private lastPointer: { key: string; at: number } | null = null
  private heldPointer: Pointer | null = null
  private readonly lastShape = new Map<string, number>()
  private stopped = false

  constructor(private readonly deps: BatcherDeps) {}

  record(body: ActivityEventBody): void {
    if (this.stopped) return
    const e = { ...body, t: this.deps.now() } as ActivityEvent
    if (e.k === 'ptr') this.pointer(e)
    else if (e.k === 'edit') this.edit(e)
    else if (e.k === 'shape') this.shape(e)
    else this.buffer.push(e)
    this.arm()
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.heldPointer) this.emitPointer(this.heldPointer)
    if (!this.buffer.length) return
    const events = trimBatch(this.buffer)
    this.buffer = []
    this.deps.send({ sent_at: this.deps.now(), events })
  }

  /** Stops everything and forgets what was waiting: the room is gone. */
  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.buffer = []
    this.heldPointer = null
  }

  /** Counterpart of `stop`, so a remount (React strict mode runs effects twice) works. */
  start(): void {
    this.stopped = false
  }

  private arm(): void {
    if (this.timer || this.stopped) return
    if (!this.buffer.length && !this.heldPointer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, FLUSH_MS)
  }

  private pointer(e: Pointer): void {
    const key = targetKey(e)
    if (this.lastPointer?.key === key) {
      this.heldPointer = null // back on the target already reported: nothing new
      return
    }
    if (!this.lastPointer || e.t - this.lastPointer.at >= POINTER_MIN_GAP_MS) this.emitPointer(e)
    else this.heldPointer = e // too soon: keep only the latest, and send it at the next flush
  }

  private emitPointer(e: Pointer): void {
    this.heldPointer = null
    const key = targetKey(e)
    if (this.lastPointer?.key === key) return
    this.buffer.push(e)
    this.lastPointer = { key, at: e.t }
  }

  private edit(e: Extract<ActivityEvent, { k: 'edit' }>): void {
    const last = this.buffer[this.buffer.length - 1]
    if (last?.k === 'edit' && last.from_line === e.from_line && last.to_line === e.to_line && e.t - last.t < EDIT_MERGE_MS) {
      last.ins = (last.ins + e.ins).slice(0, MAX_INS)
      last.removed += e.removed
      last.t = e.t
      return
    }
    this.buffer.push(e)
  }

  private shape(e: Extract<ActivityEvent, { k: 'shape' }>): void {
    const key = `${e.id}:${e.op}`
    const prev = this.lastShape.get(key)
    if (prev !== undefined && e.t - prev < SHAPE_MIN_GAP_MS) return
    if (this.lastShape.size >= MAX_TRACKED_SHAPES) this.lastShape.clear()
    this.lastShape.set(key, e.t)
    this.buffer.push(e)
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run features/interview-live/activity/batcher.test.ts`
Expected: PASS (all). If the flood test fails on event count, re-read `pointer()`: only the first sample and then at most one per 250 ms may be emitted.

- [ ] **Step 5: Typecheck, lint, no commit**

Run: `pnpm exec tsc --noEmit` and `pnpm exec eslint features/interview-live/activity` — Expected: no errors. Do not commit.

---

### Task 3: `ActivityProvider`, the workspace-leave signal and pane focus

**Files:**
- Create: `apps/web/features/interview-live/activity/ActivityProvider.tsx`
- Modify: `apps/web/app/(app)/interviews/[sessionId]/live/_components/LiveView.tsx`
- Modify: `apps/web/features/interview-live/work/WorkArea.tsx`
- Modify: `apps/web/features/interview-live/panel/ProblemPanel.tsx`
- Test: `apps/web/features/interview-live/activity/ActivityProvider.test.tsx`, `apps/web/app/(app)/interviews/[sessionId]/live/_components/LiveView.test.tsx`

**Interfaces:**
- Consumes: `ActivityBatcher`, `BatchOut` (Task 2); `LiveSession.send`.
- Produces:
  - `export function ActivityProvider({ session, children })`
  - `export function useActivity(): { record(e: ActivityEventBody): void }` (a no-op outside a provider, so existing tests that mount panes alone keep working)
  - `export function ActivityPane(props: React.ComponentProps<'section'>)`: a `<section>` that records `{ k: 'ptr', s: 'out' }` on `mouseleave`.

- [ ] **Step 1: Write the failing provider tests**

`ActivityProvider.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { MockLiveSession } from '../session/MockLiveSession'
import { ActivityPane, ActivityProvider, useActivity } from './ActivityProvider'
import { FLUSH_MS } from './batcher'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

function Recorder({ times = 1 }: { times?: number }) {
  const { record } = useActivity()
  useEffect(() => {
    for (let i = 0; i < times; i++) record({ k: 'focus', s: 'code' })
  }, [record, times])
  return null
}

describe('ActivityProvider', () => {
  it('sends what the room records as one activity batch', () => {
    const session = new MockLiveSession()
    render(<ActivityProvider session={session}><Recorder /></ActivityProvider>)
    act(() => { vi.advanceTimersByTime(FLUSH_MS) })
    expect(session.sentOf('activity.batch')).toEqual([expect.objectContaining({ events: [expect.objectContaining({ k: 'focus', s: 'code' })] })])
  })

  it('sends nothing once the room has unmounted', () => {
    const session = new MockLiveSession()
    const view = render(<ActivityProvider session={session}><Recorder /></ActivityProvider>)
    view.unmount()
    act(() => { vi.advanceTimersByTime(FLUSH_MS * 2) })
    expect(session.sentOf('activity.batch')).toHaveLength(0)
  })

  it('swallows a send that fails while disconnected', () => {
    const session = new MockLiveSession()
    session.send = () => { throw new Error('not connected') }
    render(<ActivityProvider session={session}><Recorder /></ActivityProvider>)
    expect(() => act(() => { vi.advanceTimersByTime(FLUSH_MS) })).not.toThrow()
  })

  it('is a no-op for panes mounted without a provider', () => {
    expect(() => render(<Recorder />)).not.toThrow()
  })

  it('records the pointer leaving the workspace pane', () => {
    const session = new MockLiveSession()
    render(<ActivityProvider session={session}><ActivityPane aria-label="Workspace" /></ActivityProvider>)
    fireEvent.mouseLeave(screen.getByRole('region', { name: 'Workspace' }))
    act(() => { vi.advanceTimersByTime(FLUSH_MS) })
    expect(session.sentOf('activity.batch')[0].events).toEqual([expect.objectContaining({ k: 'ptr', s: 'out' })])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run features/interview-live/activity/ActivityProvider.test.tsx`
Expected: FAIL (cannot resolve `./ActivityProvider`).

- [ ] **Step 3: Write the provider**

```tsx
'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ActivityEventBody } from '../protocol/messages'
import type { LiveSession } from '../session/types'
import { ActivityBatcher } from './batcher'

interface ActivityCtx {
  record(e: ActivityEventBody): void
}

const Ctx = createContext<ActivityCtx>({ record: () => {} })

/** What the candidate does in the workspace, reported to the interviewer (spec §5). Panes call `record`; the batcher
 * decides what is sent and when. Mounted only while the live room is, so nothing is captured outside it. */
export function ActivityProvider({ session, children }: { session: LiveSession; children: React.ReactNode }) {
  const [batcher] = useState(
    () =>
      new ActivityBatcher({
        now: () => Date.now(),
        send: (batch) => {
          try {
            session.send({ type: 'activity.batch', sent_at: batch.sent_at, events: batch.events })
          } catch {
            // disconnected: this stretch of activity is simply lost, the round goes on
          }
        },
      }),
  )
  useEffect(() => {
    batcher.start()
    return () => batcher.stop()
  }, [batcher])
  const record = useCallback((e: ActivityEventBody) => batcher.record(e), [batcher])
  const value = useMemo(() => ({ record }), [record])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useActivity(): ActivityCtx {
  return useContext(Ctx)
}

/** A `<section>` that tells the interviewer when the pointer leaves it (used for the whole workspace). */
export function ActivityPane({ onMouseLeave, ...rest }: React.ComponentProps<'section'>) {
  const { record } = useActivity()
  return (
    <section
      {...rest}
      onMouseLeave={(e) => {
        onMouseLeave?.(e)
        record({ k: 'ptr', s: 'out' })
      }}
    />
  )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run features/interview-live/activity/ActivityProvider.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the failing LiveView test**

Add to `LiveView.test.tsx` (inside `describe("LiveView", …)`), using real timers so it waits the 500 ms flush:

```tsx
  it("reports to the interviewer when the pointer leaves the workspace", async () => {
    const { session } = await mount();
    fireEvent.mouseLeave(screen.getByRole("region", { name: "Workspace" }));
    await waitFor(() => expect(session.sentOf("activity.batch")[0]?.events).toEqual([expect.objectContaining({ k: "ptr", s: "out" })]), { timeout: 2000 });
  });
```

and extend the file's imports: `import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";`.

Run: `pnpm exec vitest run "app/(app)/interviews/[sessionId]/live/_components/LiveView.test.tsx"`
Expected: FAIL (no activity batch is sent).

- [ ] **Step 6: Wire `LiveView`, `WorkArea` and `ProblemPanel`**

In `LiveView.tsx`: import `ActivityPane, ActivityProvider` from `@/features/interview-live/activity/ActivityProvider`; wrap the returned tree and swap the workspace `<section>`:

```tsx
  return (
    <ActivityProvider session={session}>
      <WorkspaceProvider session={session}>
        <div className="flex h-full min-h-0 w-full flex-col">
          {/* …unchanged header, bars and the two outer columns… */}
          <ActivityPane aria-label="Workspace" className="min-h-0 min-w-0 p-2">
            <WorkspaceSplit panel={<ProblemPanel />} work={<WorkArea session={session} />} />
          </ActivityPane>
          {/* …unchanged ToolRail and BottomBar… */}
        </div>
      </WorkspaceProvider>
    </ActivityProvider>
  )
```

(Keep every existing element as is; only add the provider wrapper and replace `<section aria-label="Workspace" className="min-h-0 min-w-0 p-2">…</section>` with `ActivityPane`.)

In `WorkArea.tsx`: `import { useActivity } from '../activity/ActivityProvider'`; inside the component `const { record } = useActivity()`; add focus capture to the two pane divs:

```tsx
        <div className={cn('absolute inset-0', surface !== 'code' && 'hidden')} onFocusCapture={() => record({ k: 'focus', s: 'code' })}>
          <CodeEditor session={session} />
        </div>
        <div className={cn('absolute inset-0', surface !== 'board' && 'hidden')} onFocusCapture={() => record({ k: 'focus', s: 'board' })}>
          <DiagramBoard session={session} />
        </div>
```

In `ProblemPanel.tsx`: `import { useActivity } from '../activity/ActivityProvider'`; `const { record } = useActivity()` at the top of the component; add `onFocusCapture={() => record({ k: 'focus', s: 'panel' })}` to the `<section aria-label="Problem" …>`.

- [ ] **Step 7: Run to verify it passes**

Run: `pnpm exec vitest run "app/(app)/interviews/[sessionId]/live" features/interview-live/work features/interview-live/panel`
Expected: PASS (no existing pane test breaks, since `useActivity` is a no-op without a provider).

- [ ] **Step 8: Typecheck, lint, no commit**

Run: `pnpm exec tsc --noEmit` and `pnpm exec eslint features/interview-live "app/(app)/interviews/[sessionId]/live"` — Expected: only the pre-existing `PrepAnimation.tsx` error, if linted. Do not commit.

---

### Task 4: Code activity: caret, selection, pointer, edits

**Files:**
- Create: `apps/web/features/interview-live/activity/codeActivity.ts`
- Modify: `apps/web/features/interview-live/work/CodeEditor.tsx`
- Test: `apps/web/features/interview-live/activity/codeActivity.test.ts`

**Interfaces:**
- Consumes: `ActivityEventBody`; `useActivity` (Task 3); `EditorCodeApi.isApplying()` (existing, `work/codeApi.ts`).
- Produces: `MAX_INS`-capped `editEvents(changes, isFlush)`, `codePointer(position, lineText)`, `caretEvent(sel, textOf)`, and `attachCodeActivity(editor, record, isApplying): () => void` (returns the disposer).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import type { ActivityEventBody } from '../protocol/messages'
import { attachCodeActivity, caretEvent, codePointer, editEvents, type ActivityEditor, type SelectionLike } from './codeActivity'

const sel = (over: Partial<SelectionLike> = {}): SelectionLike => ({
  isEmpty: () => true, startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 1, positionLineNumber: 3, positionColumn: 7, ...over,
})

describe('editEvents', () => {
  const change = { range: { startLineNumber: 4, endLineNumber: 5 }, text: 'x'.repeat(250), rangeLength: 12 }
  it('reports where, what was typed (capped) and how much was replaced', () => {
    expect(editEvents([change], false)).toEqual([{ k: 'edit', from_line: 4, to_line: 5, ins: 'x'.repeat(200), removed: 12 }])
  })
  it('ignores a whole-model replacement (a restore or a language switch)', () => {
    expect(editEvents([change], true)).toEqual([])
  })
})

describe('codePointer and caretEvent', () => {
  it('names the line under the pointer, trimmed and capped', () => {
    expect(codePointer({ lineNumber: 2, column: 5 }, () => `   ${'y'.repeat(100)}   `)).toEqual({ k: 'ptr', s: 'code', line: 2, col: 5, text: 'y'.repeat(80) })
  })
  it('says nothing when the pointer is over no text', () => {
    expect(codePointer(null, () => '')).toBeNull()
  })
  it('reports a bare caret, and a selection with its lines and text', () => {
    expect(caretEvent(sel(), () => '')).toEqual({ k: 'caret', line: 3, col: 7 })
    const picked = sel({ isEmpty: () => false, startLineNumber: 3, endLineNumber: 5 })
    expect(caretEvent(picked, () => 'z'.repeat(300))).toEqual({ k: 'caret', line: 3, col: 7, sel: [3, 5], text: 'z'.repeat(120) })
  })
})

function fakeEditor() {
  const handlers: Record<string, (e: never) => void> = {}
  const disposed: string[] = []
  const on = (name: string) => (cb: (e: never) => void) => {
    handlers[name] = cb
    return { dispose: () => { disposed.push(name) } }
  }
  const editor: ActivityEditor = {
    getModel: () => ({ getLineContent: (n) => `line ${n} text`, getValueInRange: () => 'picked' }),
    getSelection: () => sel(),
    onDidChangeModelContent: on('content') as ActivityEditor['onDidChangeModelContent'],
    onDidChangeCursorSelection: on('cursor') as ActivityEditor['onDidChangeCursorSelection'],
    onMouseMove: on('mouse') as ActivityEditor['onMouseMove'],
    onDidFocusEditorText: on('focus') as ActivityEditor['onDidFocusEditorText'],
  }
  return { editor, handlers, disposed }
}

describe('attachCodeActivity', () => {
  it('records typing, caret moves, pointer targets and focus as the candidate does them', () => {
    const { editor, handlers } = fakeEditor()
    const got: ActivityEventBody[] = []
    attachCodeActivity(editor, (e) => got.push(e), () => false)
    handlers.content({ isFlush: false, changes: [{ range: { startLineNumber: 1, endLineNumber: 1 }, text: 'a', rangeLength: 0 }] } as never)
    handlers.cursor(undefined as never)
    handlers.mouse({ target: { position: { lineNumber: 2, column: 3 } } } as never)
    handlers.focus(undefined as never)
    expect(got.map((e) => e.k)).toEqual(['edit', 'caret', 'ptr', 'focus'])
  })

  it('records nothing for the interviewer’s own edits and the cursor moves they cause', () => {
    const { editor, handlers } = fakeEditor()
    const got: ActivityEventBody[] = []
    attachCodeActivity(editor, (e) => got.push(e), () => true)
    handlers.content({ isFlush: false, changes: [{ range: { startLineNumber: 1, endLineNumber: 1 }, text: '# why?\n', rangeLength: 0 }] } as never)
    handlers.cursor(undefined as never)
    expect(got).toEqual([])
  })

  it('stops listening when disposed', () => {
    const { editor, disposed } = fakeEditor()
    attachCodeActivity(editor, () => {}, () => false)()
    expect(disposed.sort()).toEqual(['content', 'cursor', 'focus', 'mouse'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run features/interview-live/activity/codeActivity.test.ts`
Expected: FAIL (cannot resolve `./codeActivity`).

- [ ] **Step 3: Write the adapter**

```ts
/**
 * Monaco → activity events (spec §5.1): what the candidate types, where the caret and selection are, and the
 * line under the pointer. Typed against the slice of the editor it uses, so tests drive it with a fake editor.
 * The interviewer's own edits (`isApplying`) and whole-model replacements (`isFlush`) are never the candidate's.
 */
import type { ActivityEventBody } from '../protocol/messages'

export const MAX_INS = 200
const MAX_LINE_TEXT = 80
const MAX_SELECTED = 120

export interface ChangeLike {
  range: { startLineNumber: number; endLineNumber: number }
  text: string
  rangeLength: number
}
export interface SelectionLike {
  isEmpty(): boolean
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
  positionLineNumber: number
  positionColumn: number
}
export interface PositionLike {
  lineNumber: number
  column: number
}
interface Disposable {
  dispose(): void
}

export interface ActivityEditor {
  getModel(): { getLineContent(line: number): string; getValueInRange(range: SelectionLike): string } | null
  getSelection(): SelectionLike | null
  onDidChangeModelContent(cb: (e: { changes: readonly ChangeLike[]; isFlush: boolean }) => void): Disposable
  onDidChangeCursorSelection(cb: () => void): Disposable
  onMouseMove(cb: (e: { target: { position: PositionLike | null } }) => void): Disposable
  onDidFocusEditorText(cb: () => void): Disposable
}

export function editEvents(changes: readonly ChangeLike[], isFlush: boolean): ActivityEventBody[] {
  if (isFlush) return []
  return changes.map((c) => ({
    k: 'edit' as const, from_line: c.range.startLineNumber, to_line: c.range.endLineNumber, ins: c.text.slice(0, MAX_INS), removed: c.rangeLength,
  }))
}

export function codePointer(position: PositionLike | null | undefined, lineText: (line: number) => string): ActivityEventBody | null {
  if (!position) return null
  return { k: 'ptr', s: 'code', line: position.lineNumber, col: position.column, text: lineText(position.lineNumber).trim().slice(0, MAX_LINE_TEXT) }
}

export function caretEvent(sel: SelectionLike, textOf: (range: SelectionLike) => string): ActivityEventBody {
  const caret = { k: 'caret' as const, line: sel.positionLineNumber, col: sel.positionColumn }
  if (sel.isEmpty()) return caret
  return { ...caret, sel: [sel.startLineNumber, sel.endLineNumber], text: textOf(sel).slice(0, MAX_SELECTED) }
}

/** Starts reporting; the returned function stops. */
export function attachCodeActivity(editor: ActivityEditor, record: (e: ActivityEventBody) => void, isApplying: () => boolean): () => void {
  const subs = [
    editor.onDidChangeModelContent((e) => {
      if (isApplying()) return
      for (const ev of editEvents(e.changes, e.isFlush)) record(ev)
    }),
    editor.onDidChangeCursorSelection(() => {
      if (isApplying()) return
      const sel = editor.getSelection()
      const model = editor.getModel()
      if (sel && model) record(caretEvent(sel, (r) => model.getValueInRange(r)))
    }),
    editor.onMouseMove((e) => {
      const model = editor.getModel()
      const ev = model ? codePointer(e.target.position, (n) => model.getLineContent(n)) : null
      if (ev) record(ev)
    }),
    editor.onDidFocusEditorText(() => record({ k: 'focus', s: 'code' })),
  ]
  return () => subs.forEach((s) => s.dispose())
}
```

(`MAX_INS` is also exported by `batcher.ts`; this module keeps its own copy so the adapters have no dependency on the batcher.)

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run features/interview-live/activity/codeActivity.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `CodeEditor`**

In `CodeEditor.tsx`: add imports `import { useActivity } from '../activity/ActivityProvider'` and `import { attachCodeActivity, type ActivityEditor } from '../activity/codeActivity'`. At the top of the component: `const { record } = useActivity()` and `const detachActivity = useRef<(() => void) | null>(null)`. Extend the existing unmount effect and `onMount`:

```tsx
  useEffect(() => () => { registerCode(null); detachActivity.current?.() }, [registerCode])
```

(replacing `useEffect(() => () => registerCode(null), [registerCode])`), and at the end of `onMount`, after `registerCode(codeApi)`:

```tsx
    detachActivity.current?.()
    detachActivity.current = attachCodeActivity(editor as unknown as ActivityEditor, record, () => codeApi.isApplying())
```

- [ ] **Step 6: Run the editor suites**

Run: `pnpm exec vitest run features/interview-live/work features/interview-live/activity`
Expected: PASS. `pnpm exec tsc --noEmit` — no output. Do not commit.

---

### Task 5: Whiteboard activity: shapes and pointer

**Files:**
- Create: `apps/web/features/interview-live/activity/boardActivity.ts`
- Modify: `apps/web/features/interview-live/workspace/board.ts` (export `coverOf`)
- Modify: `apps/web/features/interview-live/work/DiagramBoard.tsx`
- Test: `apps/web/features/interview-live/activity/boardActivity.test.ts`

**Interfaces:**
- Consumes: `SceneElement`, `coverOf` from `../workspace/board`; `ActivityEventBody`; `useActivity`.
- Produces: `hitTest(elements, x, y): string | undefined`; `type ShapeIndex = Record<string, { version: number; x: number; y: number; label: string; deleted: boolean }>`; `shapeEvents(prev: ShapeIndex | null, elements): { events: ActivityEventBody[]; next: ShapeIndex }`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import type { SceneElement } from '../workspace/board'
import { hitTest, shapeEvents } from './boardActivity'

const box = (id: string, x: number, y: number, extra: Partial<SceneElement> = {}): SceneElement => ({ id, type: 'rectangle', x, y, width: 100, height: 50, version: 1, ...extra })
const label = (id: string, containerId: string, text: string, version = 1): SceneElement => ({ id, type: 'text', text, containerId, version })

describe('hitTest', () => {
  it('names the topmost shape under the point by its label, falling back to its type and id', () => {
    const scene = [box('aaaa1111', 0, 0), label('t1', 'aaaa1111', 'cache'), box('bbbb2222', 50, 0)]
    expect(hitTest(scene, 60, 10)).toBe('rectangle bbbb')            // the later shape is on top
    expect(hitTest(scene, 10, 10)).toBe('cache')
  })
  it('allows a few pixels of slack and is undefined over empty canvas', () => {
    expect(hitTest([box('a', 0, 0)], 104, 54)).toBeDefined()
    expect(hitTest([box('a', 0, 0)], 300, 300)).toBeUndefined()
  })
  it('ignores deleted shapes and bound label text', () => {
    expect(hitTest([box('a', 0, 0, { isDeleted: true })], 10, 10)).toBeUndefined()
    expect(hitTest([{ ...label('t', 'a', 'x'), x: 0, y: 0, width: 50, height: 20 }], 10, 10)).toBeUndefined()
  })
  it('hits a line by the box around its points, not only its start', () => {
    const arrow: SceneElement = { id: 'ar', type: 'arrow', x: 200, y: 200, width: 100, height: 100, points: [[0, 0], [-100, -100]], version: 1 }
    expect(hitTest([arrow], 150, 150)).toBe('arrow ar')
  })
  it('names a free text element by its text', () => {
    expect(hitTest([{ id: 'tx', type: 'text', text: 'O(n)', x: 0, y: 0, width: 40, height: 20 }], 5, 5)).toBe('O(n)')
  })
})

describe('shapeEvents', () => {
  it('reports nothing the first time (the baseline) and an index to compare against next', () => {
    const { events, next } = shapeEvents(null, [box('a', 0, 0)])
    expect(events).toEqual([])
    expect(next.a).toMatchObject({ version: 1, x: 0, y: 0, deleted: false })
  })

  it('reports an added, moved, relabelled and deleted shape', () => {
    let { next } = shapeEvents(null, [])
    let out = shapeEvents(next, [box('a', 0, 0)])
    expect(out.events).toEqual([{ k: 'shape', op: 'add', id: 'a', kind: 'rectangle' }])
    out = shapeEvents(out.next, [box('a', 40, 0, { version: 2 })])
    expect(out.events).toEqual([{ k: 'shape', op: 'move', id: 'a', kind: 'rectangle' }])
    out = shapeEvents(out.next, [box('a', 40, 0, { version: 2 }), label('t', 'a', 'cache')])
    expect(out.events).toEqual([{ k: 'shape', op: 'edit', id: 'a', kind: 'rectangle', label: 'cache' }])
    out = shapeEvents(out.next, [box('a', 40, 0, { version: 3, isDeleted: true }), label('t', 'a', 'cache')])
    expect(out.events).toEqual([{ k: 'shape', op: 'delete', id: 'a', kind: 'rectangle', label: 'cache' }])
    next = out.next
    expect(shapeEvents(next, [box('a', 40, 0, { version: 3, isDeleted: true }), label('t', 'a', 'cache')]).events).toEqual([])
  })

  it('never reports the interviewer’s own shapes, or its labels', () => {
    const mine: SceneElement = box('i1', 0, 0, { customData: { author: 'interviewer' } })
    const { next } = shapeEvents(null, [])
    expect(shapeEvents(next, [mine, label('t', 'i1', 'input s')]).events).toEqual([])
  })

  it('treats a restored board as a new baseline, not as drawing (the caller resets prev to null)', () => {
    expect(shapeEvents(null, [box('a', 0, 0), box('b', 200, 0), box('c', 400, 0)]).events).toEqual([])
  })

  it('caps a long label', () => {
    const { next } = shapeEvents(null, [])
    const out = shapeEvents(next, [box('a', 0, 0), label('t', 'a', 'L'.repeat(100))])
    expect(out.events[0]).toMatchObject({ label: 'L'.repeat(60) })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run features/interview-live/activity/boardActivity.test.ts`
Expected: FAIL (cannot resolve `./boardActivity`).

- [ ] **Step 3: Export `coverOf` and write the adapter**

In `workspace/board.ts` change `function coverOf(e: SceneElement): Rect {` to `export function coverOf(e: SceneElement): Rect {`.

`boardActivity.ts`:

```ts
/**
 * Excalidraw → activity events (spec §5.1): the shape under the pointer, and what the candidate adds, moves,
 * relabels or deletes. Pure of the library. The interviewer's own shapes are never the candidate's activity, and
 * a restored board is a new baseline (the caller passes `prev = null`), not drawing.
 */
import type { ActivityEventBody } from '../protocol/messages'
import { coverOf, type SceneElement } from '../workspace/board'

const HIT_PAD = 6
const MAX_LABEL = 60

export type ShapeIndex = Record<string, { version: number; x: number; y: number; label: string; deleted: boolean }>

function labelsOf(elements: readonly SceneElement[]): Map<string, string> {
  const labels = new Map<string, string>()
  for (const e of elements) if (e.type === 'text' && e.containerId && e.text && !e.isDeleted) labels.set(e.containerId, e.text)
  return labels
}

const nameOf = (e: SceneElement, labels: Map<string, string>): string =>
  (labels.get(e.id) ?? (e.type === 'text' && e.text ? e.text : `${e.type} ${e.id.slice(0, 4)}`)).slice(0, MAX_LABEL)

/** The label (or type and id) of the topmost shape under a scene point, or undefined over empty canvas. */
export function hitTest(elements: readonly SceneElement[], x: number, y: number): string | undefined {
  const labels = labelsOf(elements)
  for (let i = elements.length - 1; i >= 0; i--) {
    const e = elements[i]
    if (e.isDeleted || e.containerId || typeof e.x !== 'number') continue
    const r = coverOf(e)
    if (x >= r.x - HIT_PAD && x <= r.x + r.w + HIT_PAD && y >= r.y - HIT_PAD && y <= r.y + r.h + HIT_PAD) return nameOf(e, labels)
  }
  return undefined
}

export function shapeEvents(prev: ShapeIndex | null, elements: readonly SceneElement[]): { events: ActivityEventBody[]; next: ShapeIndex } {
  const labels = labelsOf(elements)
  const next: ShapeIndex = {}
  const events: ActivityEventBody[] = []
  for (const e of elements) {
    if (e.customData?.author === 'interviewer' || e.containerId) continue
    const label = labels.get(e.id) ?? (e.type === 'text' ? e.text ?? '' : '')
    const now = { version: e.version ?? 0, x: e.x ?? 0, y: e.y ?? 0, label, deleted: !!e.isDeleted }
    next[e.id] = now
    if (!prev) continue
    const was = prev[e.id]
    const body = (op: 'add' | 'move' | 'edit' | 'delete'): ActivityEventBody => ({
      k: 'shape', op, id: e.id, kind: e.type, ...(label ? { label: label.slice(0, MAX_LABEL) } : {}),
    })
    if (!was) {
      if (!now.deleted) events.push(body('add'))
    } else if (now.deleted && !was.deleted) events.push(body('delete'))
    else if (!now.deleted && (now.x !== was.x || now.y !== was.y)) events.push(body('move'))
    else if (!now.deleted && (now.version !== was.version || now.label !== was.label)) events.push(body('edit'))
  }
  return { events, next }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run features/interview-live/activity/boardActivity.test.ts features/interview-live/workspace`
Expected: PASS. If the "edit on relabel" assertion fails, check that a bound text element added in the same scene change updates `label` for its container (it does through `labelsOf`).

- [ ] **Step 5: Wire `DiagramBoard`**

In `DiagramBoard.tsx` add imports `import { useActivity } from '../activity/ActivityProvider'` and `import { hitTest, shapeEvents, type ShapeIndex } from '../activity/boardActivity'`. At the top of the component: `const { record } = useActivity()` and `const shapes = useRef<ShapeIndex | null>(null)`.

In `onApi`, after `board.current = adapter` and before `registerBoard(adapter)`, make a restore start a new baseline (a restored scene is not the candidate drawing):

```ts
    const restore = adapter.restore
    adapter.restore = async (data, attributes) => {
      shapes.current = null
      await restore(data, attributes)
    }
```

In the `onChange` handler, append after the summary timer code:

```tsx
          const { events, next } = shapeEvents(shapes.current, elements as unknown as readonly SceneElement[])
          shapes.current = next
          for (const ev of events) record(ev)
```

and add the pointer prop to `<Excalidraw …>`:

```tsx
        onPointerUpdate={({ pointer }) => {
          const els = raw.current?.getSceneElements() as unknown as readonly SceneElement[] | undefined
          const over = els ? hitTest(els, pointer.x, pointer.y) : undefined
          record({ k: 'ptr', s: 'board', x: Math.round(pointer.x), y: Math.round(pointer.y), ...(over ? { over } : {}) })
        }}
```

- [ ] **Step 6: Typecheck and run the suites, no commit**

Run: `pnpm exec tsc --noEmit` — Expected: no output (`onPointerUpdate` is a real prop; if tsc rejects the payload type, use `pointer` only as typed in `@excalidraw/excalidraw/dist/types/excalidraw/types.d.ts`).
Run: `pnpm exec vitest run features/interview-live` — Expected: PASS. Do not commit.

---

### Task 6: Problem-panel pointer

**Files:**
- Create: `apps/web/features/interview-live/activity/panelActivity.ts`
- Modify: `apps/web/features/interview-live/panel/ProblemPanel.tsx`
- Test: `apps/web/features/interview-live/activity/panelActivity.test.ts`, `apps/web/features/interview-live/panel/ProblemPanel.test.tsx`

**Interfaces:**
- Consumes: `useActivity` (Task 3).
- Produces: `quoteFromText(text, offset, max = 120): string` and `quoteAtPoint(doc: CaretDoc, root: Element, x: number, y: number): string | null`.

- [ ] **Step 1: Write the failing tests**

`panelActivity.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { quoteAtPoint, quoteFromText } from './panelActivity'

const TEXT = 'Given a string s, return the length of the longest substring. There is exactly one answer! Is it unique?'

describe('quoteFromText', () => {
  it('returns the sentence around the offset', () => {
    expect(quoteFromText(TEXT, TEXT.indexOf('longest'))).toBe('Given a string s, return the length of the longest substring.')
    expect(quoteFromText(TEXT, TEXT.indexOf('exactly'))).toBe('There is exactly one answer!')
    expect(quoteFromText(TEXT, TEXT.indexOf('unique'))).toBe('Is it unique?')
  })
  it('caps a long sentence to a window around the offset', () => {
    const long = `${'word '.repeat(80)}target ${'word '.repeat(80)}`
    const q = quoteFromText(long, long.indexOf('target'), 120)
    expect(q.length).toBeLessThanOrEqual(120)
    expect(q).toContain('target')
  })
  it('is safe on empty text and out-of-range offsets', () => {
    expect(quoteFromText('', 0)).toBe('')
    expect(quoteFromText('abc', 99)).toBe('abc')
  })
})

describe('quoteAtPoint', () => {
  function setup() {
    const root = document.createElement('p')
    root.textContent = TEXT
    document.body.appendChild(root)
    return { root, text: root.firstChild as Text }
  }
  it('resolves the point through caretPositionFromPoint, relative to the whole paragraph', () => {
    const { root, text } = setup()
    const doc = { caretPositionFromPoint: () => ({ offsetNode: text, offset: TEXT.indexOf('exactly') }) }
    expect(quoteAtPoint(doc, root, 1, 1)).toBe('There is exactly one answer!')
  })
  it('falls back to caretRangeFromPoint', () => {
    const { root, text } = setup()
    const doc = { caretRangeFromPoint: () => ({ startContainer: text, startOffset: TEXT.indexOf('unique') }) }
    expect(quoteAtPoint(doc, root, 1, 1)).toBe('Is it unique?')
  })
  it('is null when the point is not in this text, or the browser cannot tell', () => {
    const { root } = setup()
    const other = document.createTextNode('elsewhere')
    expect(quoteAtPoint({ caretPositionFromPoint: () => ({ offsetNode: other, offset: 2 }) }, root, 1, 1)).toBeNull()
    expect(quoteAtPoint({}, root, 1, 1)).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run features/interview-live/activity/panelActivity.test.ts`
Expected: FAIL (cannot resolve `./panelActivity`).

- [ ] **Step 3: Write the helper**

```ts
/**
 * What text the pointer rests on in the problem panel (spec §5.1): the sentence around the pointer, capped.
 * `caretPositionFromPoint` (standard) or `caretRangeFromPoint` (older Chromium and Safari) finds the text position.
 */
const BREAKS = ['. ', '? ', '! ', '\n']

export function quoteFromText(text: string, offset: number, max = 120): string {
  const at = Math.min(Math.max(offset, 0), text.length)
  const start = Math.max(0, ...BREAKS.map((b) => { const i = text.lastIndexOf(b, at - 1); return i === -1 ? -1 : i + b.length }))
  const ends = BREAKS.map((b) => text.indexOf(b, at)).filter((i) => i !== -1)
  const end = ends.length ? Math.min(...ends) + 1 : text.length
  let sentence = text.slice(start, end).trim()
  if (sentence.length > max) {
    const rel = at - start
    const from = Math.max(0, Math.min(rel - Math.floor(max / 2), sentence.length - max))
    sentence = sentence.slice(from, from + max).trim()
  }
  return sentence
}

export interface CaretDoc {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  caretRangeFromPoint?: (x: number, y: number) => { startContainer: Node; startOffset: number } | null
}

/** The sentence under (x, y) inside `root`, or null if the point is not on text in `root`. */
export function quoteAtPoint(doc: CaretDoc, root: Element, x: number, y: number): string | null {
  const pos = doc.caretPositionFromPoint?.(x, y)
  const range = pos ? null : doc.caretRangeFromPoint?.(x, y)
  const node = pos?.offsetNode ?? range?.startContainer
  const offset = pos?.offset ?? range?.startOffset ?? 0
  if (!node || node.nodeType !== Node.TEXT_NODE || !root.contains(node)) return null
  const before = document.createRange()
  before.selectNodeContents(root)
  before.setEnd(node, offset)
  const quote = quoteFromText(root.textContent ?? '', before.toString().length)
  return quote || null
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run features/interview-live/activity/panelActivity.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing panel test**

Append to `ProblemPanel.test.tsx` (check its imports first; it already mounts a `WorkspaceProvider` and shows a problem; reuse its helper if one exists, otherwise use this self-contained test and add the imports it needs):

```tsx
describe('ProblemPanel activity', () => {
  it('reports the sentence under the pointer to the interviewer', async () => {
    const session = new MockLiveSession()
    render(
      <ActivityProvider session={session}>
        <WorkspaceProvider session={session}><ProblemPanel /></WorkspaceProvider>
      </ActivityProvider>,
    )
    act(() => session.emitMessage(stampAgent({
      type: 'panel.show_problem', item_id: 'p1', label: 'Problem 1', kind: 'problem', examples: [],
      statement: 'Find the pair. Return the indices.',
    })))
    const statement = screen.getByTestId('statement-text')
    const text = statement.firstChild!.firstChild as Text
    const original = document.caretPositionFromPoint
    document.caretPositionFromPoint = (() => ({ offsetNode: text, offset: 18 })) as unknown as typeof document.caretPositionFromPoint
    try {
      fireEvent.mouseMove(statement, { clientX: 5, clientY: 5 })
      await waitFor(() => expect(session.sentOf('activity.batch')[0]?.events).toEqual([expect.objectContaining({ k: 'ptr', s: 'panel', quote: 'Return the indices.' })]), { timeout: 2000 })
    } finally {
      document.caretPositionFromPoint = original
    }
  })
})
```

Imports to add if missing: `import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'`, `import { stampAgent } from '../protocol/messages'`, `import { MockLiveSession } from '../session/MockLiveSession'`, `import { WorkspaceProvider } from '../workspace/WorkspaceProvider'`, `import { ActivityProvider } from '../activity/ActivityProvider'`, `import { ProblemPanel } from './ProblemPanel'`.

Run: `pnpm exec vitest run features/interview-live/panel/ProblemPanel.test.tsx`
Expected: FAIL (no pointer event is reported).

- [ ] **Step 6: Wire `ProblemPanel`**

In `ProblemPanel.tsx` add `import { quoteAtPoint } from '../activity/panelActivity'` and, inside the component, next to the existing `record`:

```tsx
  function onPointer(e: React.MouseEvent) {
    const el = (e.target as HTMLElement).closest('p, li')
    if (!el) return
    const quote = quoteAtPoint(document as unknown as Parameters<typeof quoteAtPoint>[0], el, e.clientX, e.clientY)
    if (quote) record({ k: 'ptr', s: 'panel', quote })
  }
```

and add `onMouseMove={onPointer}` to the `<section aria-label="Problem" …>` (next to the `onFocusCapture` from Task 3).

- [ ] **Step 7: Run to verify it passes, no commit**

Run: `pnpm exec vitest run features/interview-live` and `pnpm exec tsc --noEmit`
Expected: PASS, no type errors. Do not commit.

---

### Task 7: Disclosure on the instruction page

**Files:**
- Modify: `apps/web/app/(app)/interviews/[sessionId]/live/_components/PrejoinView.tsx`
- Test: `apps/web/app/(app)/interviews/[sessionId]/live/_components/LiveInterview.test.tsx`

**Interfaces:** none new.

- [ ] **Step 1: Write the failing test**

Add to the `describe("LiveInterview / PrejoinView", …)` block in `LiveInterview.test.tsx` (it already starts full screen):

```tsx
  it("tells the candidate the interviewer sees their cursor, typing and drawing", async () => {
    render(<LiveInterview sessionId="s1" session={new MockLiveSession()} />);
    expect(
      screen.getByText("While you work, the interviewer sees your cursor, what you type and draw, and what you say as you do it. Only short summaries of this are kept for your debrief."),
    ).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /that the interviewer sees my cursor, typing and drawing/i })).toBeInTheDocument();
    await flushMicrotasks();
  });
```

Run: `pnpm exec vitest run "app/(app)/interviews/[sessionId]/live/_components/LiveInterview.test.tsx"`
Expected: FAIL (text and label not found).

- [ ] **Step 2: Add the note and the agreement wording**

In `PrejoinView.tsx`, after `<RuleList title="Don't" items={DONTS} kind="dont" />` add:

```tsx
          <p className="m-0 rounded-[14px] border border-line-2 bg-panel/60 px-[18px] py-3.5 text-[13.5px] leading-[1.55] text-muted-foreground">
            While you work, the interviewer sees your cursor, what you type and draw, and what you say as you do it. Only short summaries of this are kept for your debrief.
          </p>
```

and change the agreement label text to:

```tsx
              I understand the interview runs in full screen with my entire
              screen shared, that the interviewer sees my cursor, typing and
              drawing, that switching tabs or screens is counted and can end
              the round, and I agree to the rules above.
```

(The existing tests find the checkbox by `/agree to the rules/i`, which the new text still contains.)

- [ ] **Step 3: Run to verify it passes, no commit**

Run: `pnpm exec vitest run "app/(app)/interviews/[sessionId]/live"` — Expected: PASS. Do not commit.

---

### Task 8: Mock-room visibility, whole-suite check and a real-browser verification

**Files:**
- Modify: `apps/web/features/interview-live/session/ScriptedLiveSession.ts`
- Test: `apps/web/features/interview-live/session/ScriptedRoom.test.tsx` (extend)

**Interfaces:** none new.

- [ ] **Step 1: Write the failing test**

Add to `ScriptedRoom.test.tsx`'s file a new test that the scripted session logs activity it receives, so the mock room's capture can be read from the browser console:

```tsx
  it('logs the activity batches it receives, for checking capture in the mock room', () => {
    const session = new ScriptedLiveSession({ speed: 0 })
    const log = vi.spyOn(console, 'debug').mockImplementation(() => {})
    session.send({ type: 'activity.batch', sent_at: 5, events: [{ k: 'focus', t: 4, s: 'code' }] })
    expect(log).toHaveBeenCalledWith('[iq-activity]', JSON.stringify([{ k: 'focus', t: 4, s: 'code' }]))
    log.mockRestore()
  })
```

Run: `pnpm exec vitest run features/interview-live/session/ScriptedRoom.test.tsx`
Expected: FAIL (nothing is logged).

- [ ] **Step 2: Log in `ScriptedLiveSession`**

In `handleSent`'s `switch (m.type)` add:

```ts
      case 'activity.batch':
        console.debug('[iq-activity]', JSON.stringify(m.events))
        break
```

- [ ] **Step 3: Run to verify it passes**

Run: `pnpm exec vitest run features/interview-live/session/ScriptedRoom.test.tsx` — Expected: PASS.

- [ ] **Step 4: Whole-suite check**

Run (from `apps/web`): `pnpm exec tsc --noEmit` and `pnpm exec vitest run` (serially, nothing else running).
Expected: tsc silent; all files pass. A lone timeout in an untouched file (`ProcessEditor`, `NodePalette`, `EnrichmentEditor`) that passes alone is load flakiness; re-run that file by itself and say so in the ledger.
Run (from `apps/ai-service`): `.venv/bin/python -m pytest -q` — Expected: all pass.

- [ ] **Step 5: Real-browser verification in the mock room**

This needs the user for the sign-in, the full-screen click and the entire-screen share (the native picker). The `claude-in-chrome` tools drive the rest.
1. Restart only the web dev server by its port with the mock flag: find the pid with `lsof -iTCP:3000 -sTCP:LISTEN -t`, `kill` it (never `pkill -f "pnpm dev"`: that also kills the API), then from `apps/web` run `NEXT_PUBLIC_LIVE_MOCK=1 nohup pnpm dev > <scratchpad>/web-dev-mock.log 2>&1 &`.
2. Open `http://localhost:3000/interviews/mock/live` in a new tab-group tab, ask the user to sign in, click **Enter full screen**, tick the agreement, **Continue**, share the entire screen, then **Enter interview**.
3. Confirm the disclosure note and the new checkbox wording on the instruction page.
4. In the live room: type in the editor, move the pointer over code lines, select two lines, switch to the whiteboard and draw a rectangle, hover the problem statement, then move the pointer out of the workspace.
5. Read the console: `read_console_messages` with pattern `iq-activity`. Expect batches at most twice a second, each with events of kinds `focus`, `edit`, `caret`, `ptr` (`code`, `board`, `panel`, `out`) and `shape`, no batch over 60 events, the rectangle as `{op: "add"}`, and **no** `shape` events for the interviewer's own scripted drawing.
6. Click the Ask button on a selection and confirm the scripted interviewer still answers (activity capture must not disturb the existing flow).
7. Restore the web dev server without the flag (kill by port, start `pnpm dev` from `apps/web`), and close the tab you opened.

- [ ] **Step 6: Report, no commit**

Record the verification result and every ruling in the ledger. Do not commit.
