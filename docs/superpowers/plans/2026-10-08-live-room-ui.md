# Live Room UI and Workspace (Module 03, plan 1 of 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the live interview room (`/interviews/[sessionId]/live`) around a shared workspace — problem panel, code editor, whiteboard — driven by the workspace protocol, with weighted proctoring, and runnable end to end against a scripted mock interviewer.

**Architecture:** A Zod module defines the browser ↔ agent workspace protocol and generates the published JSON Schema. The `LiveSession` seam carries protocol messages over LiveKit text/byte streams (LiveKit adapter) or in memory (mock). A `WorkspaceProvider` routes the agent's instructions to pure state (panel reducer) and to editor/whiteboard adapters, and acknowledges each one. Proctoring is a pure weighted ledger fed by browser signals. A `ScriptedLiveSession` plays a canned interview so the whole room works without the AI service.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind 3, Zod 4 (`z.toJSONSchema`), `livekit-client` 2.20 (text and byte streams), `@monaco-editor/react`, `@excalidraw/excalidraw` 0.18, Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-10-08-live-interviewer-design.md` (§6 protocol, §7 proctoring, §10 room UI, §5.6 ending). Plans 2 (interviewer worker) and 3 (API wiring and the live run) follow.

## Global Constraints

- **No commits.** Leave all changes in the working tree; the user reviews and commits.
- **Test runs:** the user's standing rule is no vitest/tsc/eslint runs unless they say so. Ask once at the start of execution whether test runs are allowed for this plan. If not, skip every "Run" step, keep writing the tests, and report them as written but not run.
- **No new runtime dependencies.** Everything below uses packages already in `apps/web/package.json`.
- **Design language:** the HUD layer (`@/components/hud`: `StatusDot`, `Count`, `HudEmpty`), mono uppercase headers with leader lines, existing radii (cards 14px, dialogs 16px, shell 18px), pill buttons. **Orange (`brand`) is the only accent and marks interviewer content** (highlights, inserted code, drawings, interviewer sections).
- **Candidate never sees problem names, topics or difficulty.** Cards are labelled generically ("Problem 1"); labels come from the agent.
- **Copy:** "resume", never "résumé". Proctoring copy never says the round pauses.
- **Style:** files under `features/interview-live/` use single quotes and no semicolons; route `_components` files keep their own existing style (`LiveInterview.tsx`, `ChecksView.tsx`, `RoomFrame.tsx`, `PrejoinView.tsx` use double quotes and semicolons; `LiveView.tsx` and `EndedView.tsx` use single quotes, no semicolons).
- Client components start with `'use client'`. Viewport units inside the app need `calc(Nvh/var(--hud-zoom,1))`; the room already runs at 100% zoom (`HudZoomOff`).
- Commands run from `apps/web` (e.g. `cd apps/web && pnpm vitest run <path>`).

## Review Focus

1. **The candidate types while an interviewer code edit is in flight** → the edit lands on the moved line or is refused with `line_changed`; the candidate's code is never corrupted (Task 8, shifted-anchor test).
2. **A tab switch that also drops full screen** → counts once, as one tab change, and the agent hears one event (Task 4 ledger test, Task 5 `useProctor` test).
3. **The agent re-sends a problem it already showed** → no duplicate tab, its sections and highlights survive (Task 2 reducer test).
4. **The candidate refreshes mid-round** → the browser says `workspace.hello`, and `workspace.restore` puts the problems, sections, code and whiteboard back (Task 6 provider test).
5. **The candidate presses End and the interviewer never answers** → the room ends locally as `candidate_ended` after 5 s, and a disconnect during `ending` is never mislabelled `technical` (Task 5 provider test).

---

### Task 1: Workspace protocol contract

**Files:**
- Create: `apps/web/features/interview-live/protocol/messages.ts`
- Create: `apps/web/features/interview-live/protocol/messages.test.ts`
- Create: `apps/web/scripts/generate-live-schema.ts`
- Create: `packages/contracts/live-workspace.examples.json`
- Create (generated): `packages/contracts/live-workspace.schema.json`
- Modify: `apps/web/package.json` (scripts)
- Modify: `docs/superpowers/specs/2026-10-08-live-interviewer-design.md` (§6.1, §6.2)

**Interfaces:**
- Produces (from `protocol/messages.ts`):
  - constants `PROTOCOL_VERSION = 1`, `WORKSPACE_TOPIC = 'workspace'`, `BYTE_TOPICS = { boardSnapshot, boardBackup, boardRestore }`
  - Zod schemas (values) and inferred types of the same names: `AgentMessage`, `WebMessage`, `Section`, `Example`
  - types: `Author`, `SectionKind`, `CodeLanguage`, `EndReason`, `ProctorKind`, `LineAnchor`, `DrawElement`, `WireCard`, `AgentMessageBody`, `WebMessageBody`, `AgentMessageOf<T>`
  - functions: `parseAgentMessage(raw: string): AgentMessage | null`, `stampWeb(body: WebMessageBody): WebMessage`, `stampAgent(body: AgentMessageBody): AgentMessage`, `newMessageId(prefix?: string): string`, `workspaceJsonSchema(): Record<string, unknown>`
  - arrays `AGENT_MESSAGE_TYPES`, `WEB_MESSAGE_TYPES`

- [ ] **Step 1: Write the shared examples file**

Create `packages/contracts/live-workspace.examples.json` (one valid message per type; the AI service tests against the same file in plan 2):

```json
{
  "panel.show_problem": { "v": 1, "id": "a_show", "type": "panel.show_problem", "item_id": "slot-1", "label": "Problem 1", "kind": "problem", "statement": "Given a string s, return the length of the longest substring that contains at most two distinct characters.", "examples": [{ "input": "s = \"eceba\"", "output": "3", "explanation": "The substring is \"ece\"." }, { "input": "s = \"ccaabbb\"", "output": "5", "explanation": "The substring is \"aabbb\"." }] },
  "panel.add_section": { "v": 1, "id": "a_sec", "type": "panel.add_section", "item_id": "slot-1", "section": { "id": "sec-1", "kind": "constraints", "title": "Constraints", "body": "1 <= s.length <= 10^5\ns consists of English letters.", "author": "interviewer" } },
  "panel.highlight": { "v": 1, "id": "a_hl", "type": "panel.highlight", "item_id": "slot-1", "highlight_id": "hl-1", "quote": "at most two distinct characters", "occurrence": 0, "note": "This is the key condition." },
  "panel.clear_highlight": { "v": 1, "id": "a_hlc", "type": "panel.clear_highlight", "highlight_id": "hl-1" },
  "code.comment": { "v": 1, "id": "a_cc", "type": "code.comment", "at": { "line": 4, "expect": "for i in range(len(s)):" }, "text": "What happens here when s is empty?", "purpose": "question" },
  "code.insert": { "v": 1, "id": "a_ci", "type": "code.insert", "at": "top", "text": "print(longest(\"eceba\"))  # expect 3", "purpose": "test_input" },
  "code.highlight": { "v": 1, "id": "a_ch", "type": "code.highlight", "highlight_id": "ch-1", "start_line": 4, "end_line": 6, "expect": "for i in range(len(s)):", "note": "Walk me through this loop." },
  "code.clear_highlight": { "v": 1, "id": "a_chc", "type": "code.clear_highlight", "highlight_id": "ch-1" },
  "board.request_snapshot": { "v": 1, "id": "a_snap", "type": "board.request_snapshot", "request_id": "snap-1" },
  "board.draw": { "v": 1, "id": "a_draw", "type": "board.draw", "elements": [{ "type": "rectangle", "id": "n1", "label": "Client" }, { "type": "rectangle", "id": "n2", "label": "Service" }, { "type": "arrow", "id": "e1", "from": "n1", "to": "n2", "label": "request" }] },
  "workspace.restore": { "v": 1, "id": "a_rest", "type": "workspace.restore", "cards": [{ "item_id": "slot-1", "label": "Problem 1", "kind": "problem", "statement": "Given a string s, return the length of the longest substring that contains at most two distinct characters.", "examples": [{ "input": "s = \"eceba\"", "output": "3" }], "sections": [], "highlights": [{ "highlight_id": "hl-1", "quote": "two distinct", "occurrence": 0, "author": "candidate" }] }], "active_item_id": "slot-1", "code": { "language": "python", "text": "def longest(s):\n    return 0\n" }, "board": false },
  "session.ending": { "v": 1, "id": "a_end", "type": "session.ending", "reason": "completed", "message": "Thanks for your time today. That's the end of the interview." },
  "ack": { "v": 1, "id": "w_ack", "type": "ack", "ref": "a_cc", "ok": false, "reason": "line_changed" },
  "panel.section_added": { "v": 1, "id": "w_sec", "type": "panel.section_added", "item_id": "slot-1", "section": { "id": "sec-2", "kind": "note", "title": "Note", "body": "Try a sliding window?", "author": "candidate" } },
  "panel.highlight_added": { "v": 1, "id": "w_hl", "type": "panel.highlight_added", "item_id": "slot-1", "highlight_id": "hl-2", "quote": "longest substring", "occurrence": 0 },
  "code.highlight_added": { "v": 1, "id": "w_ch", "type": "code.highlight_added", "start_line": 2, "end_line": 3, "text": "    seen = {}\n    left = 0" },
  "ask.selection": { "v": 1, "id": "w_ask", "type": "ask.selection", "surface": "statement", "quote": "at most two distinct characters", "item_id": "slot-1" },
  "code.snapshot": { "v": 1, "id": "w_code", "type": "code.snapshot", "version": 3, "language": "python", "text": "def longest(s):\n    return 0\n" },
  "board.summary": { "v": 1, "id": "w_board", "type": "board.summary", "version": 2, "text": "rectangle \"Client\"\nrectangle \"Service\"\narrow Client → Service" },
  "proctor.event": { "v": 1, "id": "w_pro", "type": "proctor.event", "kind": "tab_hidden", "weight": 1, "at": 1760000000000, "counts": { "tab_changes": 1, "screen_changes": 0.5, "full_violations": 1 } },
  "workspace.hello": { "v": 1, "id": "w_hello", "type": "workspace.hello", "has_content": false },
  "session.end_request": { "v": 1, "id": "w_endreq", "type": "session.end_request" }
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/features/interview-live/protocol/messages.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  AGENT_MESSAGE_TYPES,
  AgentMessage,
  WEB_MESSAGE_TYPES,
  WebMessage,
  parseAgentMessage,
  stampAgent,
  stampWeb,
  workspaceJsonSchema,
} from './messages'

const contracts = (name: string) => fileURLToPath(new URL(`../../../../../packages/contracts/${name}`, import.meta.url))
const examples = JSON.parse(readFileSync(contracts('live-workspace.examples.json'), 'utf8')) as Record<string, object>

describe('workspace protocol', () => {
  it('has a valid example for every agent message type', () => {
    for (const type of AGENT_MESSAGE_TYPES) {
      const parsed = AgentMessage.safeParse(examples[type])
      expect(parsed.success, `${type}: ${parsed.error?.message}`).toBe(true)
    }
  })

  it('has a valid example for every web message type', () => {
    for (const type of WEB_MESSAGE_TYPES) {
      const parsed = WebMessage.safeParse(examples[type])
      expect(parsed.success, `${type}: ${parsed.error?.message}`).toBe(true)
    }
  })

  it('has no example for a type the protocol does not define', () => {
    expect(Object.keys(examples).sort()).toEqual([...AGENT_MESSAGE_TYPES, ...WEB_MESSAGE_TYPES].sort())
  })

  it('keeps the committed JSON Schema in step with the Zod source', () => {
    const committed = JSON.parse(readFileSync(contracts('live-workspace.schema.json'), 'utf8'))
    expect(committed).toEqual(workspaceJsonSchema())
  })

  it('drops malformed JSON, web messages, other versions and over-long code inserts', () => {
    expect(parseAgentMessage('{nope')).toBeNull()
    expect(parseAgentMessage(JSON.stringify(examples['ack']))).toBeNull()
    expect(parseAgentMessage(JSON.stringify({ ...examples['panel.add_section'], v: 2 }))).toBeNull()
    expect(parseAgentMessage(JSON.stringify({ ...examples['code.insert'], text: 'x'.repeat(2001) }))).toBeNull()
    expect(parseAgentMessage(JSON.stringify(examples['code.comment']))?.type).toBe('code.comment')
  })

  it('stamps the version and a fresh id', () => {
    const a = stampWeb({ type: 'session.end_request' })
    const b = stampWeb({ type: 'session.end_request' })
    expect(a.v).toBe(1)
    expect(a.id).not.toBe(b.id)
    expect(stampAgent({ type: 'panel.clear_highlight', highlight_id: 'h' }).id).toMatch(/^a_/)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd apps/web && pnpm vitest run features/interview-live/protocol/messages.test.ts`
Expected: FAIL — `Cannot find module './messages'`.

- [ ] **Step 4: Write the protocol module**

Create `apps/web/features/interview-live/protocol/messages.ts`:

```ts
/**
 * The live-room workspace protocol (spec §6): JSON messages between the browser and the interviewer
 * agent on the LiveKit text-stream topic `workspace`. This Zod module is the source of the published
 * contract: `pnpm --filter @interviewiq/web generate:live-schema` writes
 * packages/contracts/live-workspace.schema.json from it, and the AI service mirrors it in Pydantic.
 * Both sides test against packages/contracts/live-workspace.examples.json.
 */
import { z } from 'zod'

export const PROTOCOL_VERSION = 1
export const WORKSPACE_TOPIC = 'workspace'
/** Byte-stream topics: a PNG of the whiteboard, its compressed scene backup, and a restore from the agent. */
export const BYTE_TOPICS = {
  boardSnapshot: 'workspace.board.snapshot',
  boardBackup: 'workspace.board.backup',
  boardRestore: 'workspace.board.restore',
} as const

const Id = z.string().min(1).max(64)
const Line = z.number().int().min(1)
const header = { v: z.literal(PROTOCOL_VERSION), id: Id }

export const SectionKind = z.enum(['constraints', 'format', 'clarification', 'hint', 'explanation', 'note'])
export const Author = z.enum(['interviewer', 'candidate'])
export const CodeLanguage = z.enum(['python', 'javascript', 'typescript', 'java', 'cpp', 'go'])
export const EndReason = z.enum(['completed', 'ended_by_interviewer', 'candidate_ended', 'technical'])
export const ProctorKind = z.enum(['tab_hidden', 'window_blur', 'external_display', 'fullscreen_exit', 'share_stopped'])

export const Example = z.object({
  input: z.string().max(4000),
  output: z.string().max(4000),
  explanation: z.string().max(2000).optional(),
})
export const Section = z.object({
  id: Id,
  kind: SectionKind,
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(4000),
  author: Author,
})
const WireHighlight = z.object({
  highlight_id: Id,
  quote: z.string().min(1).max(500),
  occurrence: z.number().int().min(0),
  note: z.string().max(300).optional(),
  author: Author,
})
const ItemKind = z.enum(['problem', 'question'])
export const Card = z.object({
  item_id: Id,
  label: z.string().min(1).max(40),
  kind: ItemKind,
  statement: z.string().min(1).max(20000),
  examples: z.array(Example).max(2),
  sections: z.array(Section).max(50),
  highlights: z.array(WireHighlight).max(100),
})
/** Where a code instruction lands: the top of the file, or above line N whose text the agent saw as `expect`. */
export const LineAnchor = z.union([z.literal('top'), z.object({ line: Line, expect: z.string().max(1000) })])
export const DrawElement = z.object({
  type: z.enum(['rectangle', 'ellipse', 'diamond', 'text', 'arrow']),
  id: Id,
  label: z.string().max(200).optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  from: Id.optional(),
  to: Id.optional(),
})

// ---------------------------------------------------------------- agent → web

export const ShowProblem = z.object({
  ...header, type: z.literal('panel.show_problem'), item_id: Id, label: z.string().min(1).max(40), kind: ItemKind,
  statement: z.string().min(1).max(20000), examples: z.array(Example).max(2),
})
export const AddSection = z.object({ ...header, type: z.literal('panel.add_section'), item_id: Id, section: Section })
export const PanelHighlight = z.object({
  ...header, type: z.literal('panel.highlight'), item_id: Id, highlight_id: Id, quote: z.string().min(1).max(500),
  occurrence: z.number().int().min(0).optional(), note: z.string().max(300).optional(),
})
export const PanelClearHighlight = z.object({ ...header, type: z.literal('panel.clear_highlight'), highlight_id: Id })
export const CodeComment = z.object({
  ...header, type: z.literal('code.comment'), at: LineAnchor, text: z.string().min(1).max(1000),
  purpose: z.enum(['question', 'doubt', 'hint']),
})
export const CodeInsert = z.object({
  ...header, type: z.literal('code.insert'), at: LineAnchor, text: z.string().min(1).max(2000),
  purpose: z.enum(['stub', 'test_input']),
})
export const CodeHighlight = z.object({
  ...header, type: z.literal('code.highlight'), highlight_id: Id, start_line: Line, end_line: Line,
  expect: z.string().max(1000), note: z.string().max(300).optional(),
})
export const CodeClearHighlight = z.object({ ...header, type: z.literal('code.clear_highlight'), highlight_id: Id })
export const BoardRequestSnapshot = z.object({ ...header, type: z.literal('board.request_snapshot'), request_id: Id })
export const BoardDraw = z.object({ ...header, type: z.literal('board.draw'), elements: z.array(DrawElement).min(1).max(40) })
export const WorkspaceRestore = z.object({
  ...header, type: z.literal('workspace.restore'), cards: z.array(Card).max(20), active_item_id: Id.nullable(),
  code: z.object({ language: CodeLanguage, text: z.string().max(100000) }).nullable(),
  board: z.boolean(),
})
export const SessionEnding = z.object({ ...header, type: z.literal('session.ending'), reason: EndReason, message: z.string().max(1000) })

export const AgentMessage = z.discriminatedUnion('type', [
  ShowProblem, AddSection, PanelHighlight, PanelClearHighlight, CodeComment, CodeInsert, CodeHighlight,
  CodeClearHighlight, BoardRequestSnapshot, BoardDraw, WorkspaceRestore, SessionEnding,
])

// ---------------------------------------------------------------- web → agent

export const Ack = z.object({ ...header, type: z.literal('ack'), ref: Id, ok: z.boolean(), reason: z.string().max(200).optional() })
export const SectionAdded = z.object({ ...header, type: z.literal('panel.section_added'), item_id: Id, section: Section })
export const HighlightAdded = z.object({
  ...header, type: z.literal('panel.highlight_added'), item_id: Id, highlight_id: Id,
  quote: z.string().min(1).max(500), occurrence: z.number().int().min(0),
})
export const CodeHighlightAdded = z.object({
  ...header, type: z.literal('code.highlight_added'), start_line: Line, end_line: Line, text: z.string().max(4000),
})
export const AskSelection = z.object({
  ...header, type: z.literal('ask.selection'), surface: z.enum(['statement', 'code', 'board']),
  quote: z.string().min(1).max(4000), item_id: Id.optional(), lines: z.tuple([Line, Line]).optional(),
})
export const CodeSnapshot = z.object({
  ...header, type: z.literal('code.snapshot'), version: z.number().int().min(0), language: CodeLanguage, text: z.string().max(100000),
})
export const BoardSummary = z.object({ ...header, type: z.literal('board.summary'), version: z.number().int().min(0), text: z.string().max(20000) })
export const ProctorEventMessage = z.object({
  ...header, type: z.literal('proctor.event'), kind: ProctorKind, weight: z.union([z.literal(1), z.literal(0.5)]),
  at: z.number().int().min(0),
  counts: z.object({ tab_changes: z.number().int().min(0), screen_changes: z.number().min(0), full_violations: z.number().int().min(0) }),
})
export const Hello = z.object({ ...header, type: z.literal('workspace.hello'), has_content: z.boolean() })
export const EndRequest = z.object({ ...header, type: z.literal('session.end_request') })

export const WebMessage = z.discriminatedUnion('type', [
  Ack, SectionAdded, HighlightAdded, CodeHighlightAdded, AskSelection, CodeSnapshot, BoardSummary,
  ProctorEventMessage, Hello, EndRequest,
])

export const WorkspaceMessage = z.union([AgentMessage, WebMessage])

export type AgentMessage = z.infer<typeof AgentMessage>
export type WebMessage = z.infer<typeof WebMessage>
export type Section = z.infer<typeof Section>
export type Example = z.infer<typeof Example>
export type Author = z.infer<typeof Author>
export type SectionKind = z.infer<typeof SectionKind>
export type CodeLanguage = z.infer<typeof CodeLanguage>
export type EndReason = z.infer<typeof EndReason>
export type ProctorKind = z.infer<typeof ProctorKind>
export type LineAnchor = z.infer<typeof LineAnchor>
export type DrawElement = z.infer<typeof DrawElement>
export type WireCard = z.infer<typeof Card>

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
/** A message before `v` and `id` are stamped. */
export type AgentMessageBody = DistributiveOmit<AgentMessage, 'v' | 'id'>
export type WebMessageBody = DistributiveOmit<WebMessage, 'v' | 'id'>
export type AgentMessageOf<T extends AgentMessage['type']> = Extract<AgentMessage, { type: T }>

export const AGENT_MESSAGE_TYPES: string[] = AgentMessage.options.map((o) => o.shape.type.value)
export const WEB_MESSAGE_TYPES: string[] = WebMessage.options.map((o) => o.shape.type.value)

/** An agent → web message from a text stream, or null if it isn't one this version understands. */
export function parseAgentMessage(raw: string): AgentMessage | null {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = AgentMessage.safeParse(data)
  return parsed.success ? parsed.data : null
}

let seq = 0
export function newMessageId(prefix = 'w'): string {
  seq += 1
  return `${prefix}_${Date.now().toString(36)}_${seq.toString(36)}`
}

export function stampWeb(body: WebMessageBody): WebMessage {
  return { ...body, v: PROTOCOL_VERSION, id: newMessageId('w') } as WebMessage
}

export function stampAgent(body: AgentMessageBody): AgentMessage {
  return { ...body, v: PROTOCOL_VERSION, id: newMessageId('a') } as AgentMessage
}

export function workspaceJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(WorkspaceMessage) as Record<string, unknown>
}
```

- [ ] **Step 5: Add the schema generator and generate the schema**

Create `apps/web/scripts/generate-live-schema.ts`:

```ts
// Writes packages/contracts/live-workspace.schema.json from the Zod protocol module.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { workspaceJsonSchema } from '../features/interview-live/protocol/messages'

const out = fileURLToPath(new URL('../../../packages/contracts/live-workspace.schema.json', import.meta.url))
writeFileSync(out, `${JSON.stringify(workspaceJsonSchema(), null, 2)}\n`)
console.log(`wrote ${out}`)
```

In `apps/web/package.json` `scripts`, add after `"generate:types"`:

```json
    "generate:live-schema": "tsx scripts/generate-live-schema.ts"
```

Run: `cd apps/web && pnpm generate:live-schema`
Expected: `wrote …/packages/contracts/live-workspace.schema.json`, and the file exists.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/web && pnpm vitest run features/interview-live/protocol/messages.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 7: Bring the spec in line with the protocol as built**

In `docs/superpowers/specs/2026-10-08-live-interviewer-design.md` §6.1, replace:

```
- JSON messages on the LiveKit data channel, reliable, topic `workspace`, each with `v` (protocol version), `id` and
  `type`. Images use LiveKit byte streams.
```

with:

```
- JSON messages on LiveKit **text streams**, topic `workspace` (reliable, ordered, any size), each with `v`
  (protocol version), `id` and `type`. Images and whiteboard scenes use LiveKit byte streams
  (`workspace.board.snapshot`, `workspace.board.backup`, `workspace.board.restore`).
- **The agent sends no workspace instruction before the browser's first `workspace.hello`**, so nothing arrives
  before the room is ready to apply it.
```

and replace:

```
- **Contract:** `packages/contracts/live-workspace.schema.json` is the source of truth. TypeScript types (web) and
  Pydantic models (AI service) mirror it, and both sides test against shared example messages in
  `packages/contracts/live-workspace.examples/`.
```

with:

```
- **Contract:** the Zod module `apps/web/features/interview-live/protocol/messages.ts` is the source;
  `pnpm --filter @interviewiq/web generate:live-schema` writes `packages/contracts/live-workspace.schema.json` from it
  (a test fails when the file is stale). The AI service mirrors it in Pydantic, and both sides test against
  `packages/contracts/live-workspace.examples.json` (one example per message type).
```

In the §6.2 table, after the `panel.highlight_added` row, add:

```
| web → agent | `code.highlight_added` | `{start_line, end_line, text}`: lines the candidate highlighted in the editor. |
```

---

### Task 2: Transcript segments and problem-panel state

**Files:**
- Create: `apps/web/features/interview-live/session/transcript.ts`
- Create: `apps/web/features/interview-live/session/transcript.test.ts`
- Create: `apps/web/features/interview-live/workspace/panel.ts`
- Create: `apps/web/features/interview-live/workspace/panel.test.ts`

**Interfaces:**
- Consumes: `Section`, `Example`, `Author`, `WireCard` types from Task 1.
- Produces:
  - `transcript.ts`: `type TranscriptSpeaker = 'interviewer' | 'candidate' | 'system'`; `interface TranscriptSegment { id: string; speaker: TranscriptSpeaker; text: string; final: boolean; at: number }`; `applySegment(list: TranscriptSegment[], seg: TranscriptSegment): TranscriptSegment[]`; `systemNote(text: string, at?: number): TranscriptSegment`
  - `panel.ts`: `PanelHighlight { id; quote; occurrence; note?; author }`, `ProblemCard { itemId; label; kind; statement; examples; sections; highlights }`, `PanelState { cards; activeId; flashId }`, `PanelAction` (`show | add_section | highlight | clear_highlight | select | restore | flash_done`), `EMPTY_PANEL`, `panelReducer`, `hasCard(state, itemId)`, `cardFromWire(c: WireCard)`, `findQuote(text, quote, occurrence?) → Span | null`, `occurrenceAt(text, quote, start)`, `markSegments(text, highlights) → TextPiece[]`

- [ ] **Step 1: Write the failing transcript test**

Create `apps/web/features/interview-live/session/transcript.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applySegment, systemNote, type TranscriptSegment } from './transcript'

const seg = (over: Partial<TranscriptSegment> = {}): TranscriptSegment => ({
  id: 's1', speaker: 'candidate', text: 'hel', final: false, at: 1, ...over,
})

describe('applySegment', () => {
  it('appends a new segment', () => {
    expect(applySegment([], seg())).toEqual([seg()])
  })

  it('updates an interim segment in place and keeps its first arrival time', () => {
    const list = applySegment(applySegment([], seg()), seg({ text: 'hello', at: 9 }))
    expect(list).toEqual([seg({ text: 'hello', at: 1 })])
  })

  it('ignores a late interim update after the segment is final', () => {
    const final = applySegment([seg()], seg({ text: 'hello there', final: true }))
    expect(applySegment(final, seg({ text: 'hello th' }))).toBe(final)
  })

  it('keeps arrival order when an earlier segment is finalised', () => {
    const list = [seg({ id: 'a' }), seg({ id: 'b', speaker: 'interviewer' })]
    expect(applySegment(list, seg({ id: 'a', text: 'x', final: true })).map((s) => s.id)).toEqual(['a', 'b'])
  })
})

describe('systemNote', () => {
  it('makes a final system segment with a unique id', () => {
    const a = systemNote('Tab change logged', 5)
    const b = systemNote('Tab change logged', 5)
    expect(a).toMatchObject({ speaker: 'system', text: 'Tab change logged', final: true, at: 5 })
    expect(a.id).not.toBe(b.id)
  })
})
```

- [ ] **Step 2: Write the failing panel test**

Create `apps/web/features/interview-live/workspace/panel.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Section } from '../protocol/messages'
import {
  EMPTY_PANEL,
  cardFromWire,
  findQuote,
  hasCard,
  markSegments,
  occurrenceAt,
  panelReducer,
  type PanelHighlight,
  type PanelState,
} from './panel'

const STATEMENT = 'Return the longest substring with at most two distinct characters. Two distinct is the limit.'
const show = (state: PanelState, itemId = 'slot-1', label = 'Problem 1') =>
  panelReducer(state, { type: 'show', card: { itemId, label, kind: 'problem', statement: STATEMENT, examples: [] } })
const section = (id: string, body = 'n ≤ 10^5'): Section => ({ id, kind: 'constraints', title: 'Constraints', body, author: 'interviewer' })
const hl = (id: string, quote: string, author: PanelHighlight['author'] = 'interviewer'): PanelHighlight => ({ id, quote, occurrence: 0, author })

describe('panelReducer', () => {
  it('shows a problem, makes it active and flashes its tab', () => {
    const s = show(EMPTY_PANEL)
    expect(s.cards).toHaveLength(1)
    expect(s.activeId).toBe('slot-1')
    expect(s.flashId).toBe('slot-1')
    expect(hasCard(s, 'slot-1')).toBe(true)
  })

  it('re-showing the same item updates it without duplicating or losing sections and highlights', () => {
    let s = show(EMPTY_PANEL)
    s = panelReducer(s, { type: 'add_section', itemId: 'slot-1', section: section('c1') })
    s = panelReducer(s, { type: 'highlight', itemId: 'slot-1', highlight: hl('h1', 'two distinct') })
    s = show(show(s, 'slot-2', 'Problem 2'))
    expect(s.cards.map((c) => c.itemId)).toEqual(['slot-1', 'slot-2'])
    expect(s.cards[0].sections).toHaveLength(1)
    expect(s.cards[0].highlights).toHaveLength(1)
    expect(s.activeId).toBe('slot-1')
  })

  it('ignores a section for an unknown item and replaces a section with the same id', () => {
    let s = panelReducer(show(EMPTY_PANEL), { type: 'add_section', itemId: 'nope', section: section('c1') })
    expect(s.cards[0].sections).toHaveLength(0)
    s = panelReducer(s, { type: 'add_section', itemId: 'slot-1', section: section('c1', 'old') })
    s = panelReducer(s, { type: 'add_section', itemId: 'slot-1', section: section('c1', 'new') })
    expect(s.cards[0].sections.map((x) => x.body)).toEqual(['new'])
  })

  it('clears a highlight by id across cards', () => {
    let s = panelReducer(show(EMPTY_PANEL), { type: 'highlight', itemId: 'slot-1', highlight: hl('h1', 'two distinct') })
    s = panelReducer(s, { type: 'clear_highlight', highlightId: 'h1' })
    expect(s.cards[0].highlights).toEqual([])
  })

  it('selects only known cards, restores, and clears the flash', () => {
    let s = show(EMPTY_PANEL)
    expect(panelReducer(s, { type: 'select', itemId: 'nope' })).toBe(s)
    s = panelReducer(s, { type: 'flash_done' })
    expect(s.flashId).toBeNull()
    const restored = panelReducer(EMPTY_PANEL, { type: 'restore', cards: s.cards, activeId: null })
    expect(restored.activeId).toBe('slot-1')
    expect(restored.flashId).toBeNull()
  })
})

describe('cardFromWire', () => {
  it('maps the wire card to the panel card', () => {
    const card = cardFromWire({
      item_id: 'slot-1', label: 'Problem 1', kind: 'problem', statement: STATEMENT, examples: [], sections: [],
      highlights: [{ highlight_id: 'h1', quote: 'two distinct', occurrence: 1, author: 'candidate' }],
    })
    expect(card.itemId).toBe('slot-1')
    expect(card.highlights[0]).toMatchObject({ id: 'h1', quote: 'two distinct', occurrence: 1, author: 'candidate' })
  })
})

describe('findQuote', () => {
  it('finds the exact text and the nth occurrence', () => {
    expect(findQuote(STATEMENT, 'two distinct')).toEqual({ start: 42, end: 54 })
    expect(findQuote('a b a b', 'a', 1)).toEqual({ start: 4, end: 5 })
  })

  it('matches across re-flowed whitespace', () => {
    const span = findQuote('at most\n  two distinct', 'most two')
    expect(span).not.toBeNull()
    expect('at most\n  two distinct'.slice(span!.start, span!.end)).toBe('most\n  two')
  })

  it('returns null for missing or empty quotes', () => {
    expect(findQuote(STATEMENT, 'three distinct')).toBeNull()
    expect(findQuote(STATEMENT, '   ')).toBeNull()
    expect(findQuote('a b', 'a', 3)).toBeNull()
  })
})

describe('occurrenceAt', () => {
  it('counts earlier copies of the quote', () => {
    expect(occurrenceAt('ab ab ab', 'ab', 0)).toBe(0)
    expect(occurrenceAt('ab ab ab', 'ab', 3)).toBe(1)
    expect(occurrenceAt('ab ab ab', 'ab', 6)).toBe(2)
  })
})

describe('markSegments', () => {
  it('splits text into plain and highlighted pieces; the earlier highlight wins an overlap', () => {
    const pieces = markSegments('one two three', [hl('b', 'two three'), hl('a', 'one two', 'candidate')])
    expect(pieces.map((p) => [p.text, p.highlight?.id ?? null])).toEqual([['one two', 'a'], [' three', null]])
  })

  it('skips highlights whose quote is gone', () => {
    expect(markSegments('abc', [hl('x', 'zzz')])).toEqual([{ text: 'abc' }])
  })
})
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `cd apps/web && pnpm vitest run features/interview-live/session/transcript.test.ts features/interview-live/workspace/panel.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Write `transcript.ts`**

```ts
/**
 * The room's conversation as segments. LiveKit Agents streams each utterance as a segment: interim
 * words update it in place until a final version locks it.
 */
export type TranscriptSpeaker = 'interviewer' | 'candidate' | 'system'

export interface TranscriptSegment {
  id: string
  speaker: TranscriptSpeaker
  text: string
  final: boolean
  /** When the segment first arrived (ms since epoch). */
  at: number
}

/** Inserts a segment or updates it by id. A final segment ignores later interim updates. */
export function applySegment(list: TranscriptSegment[], seg: TranscriptSegment): TranscriptSegment[] {
  const i = list.findIndex((s) => s.id === seg.id)
  if (i === -1) return [...list, seg]
  const prev = list[i]
  if (prev.final && !seg.final) return list
  const next = list.slice()
  next[i] = { ...seg, at: prev.at }
  return next
}

let notes = 0

/** A centred room notice (proctoring, connection) in the transcript. */
export function systemNote(text: string, at: number = Date.now()): TranscriptSegment {
  notes += 1
  return { id: `note-${at}-${notes}`, speaker: 'system', text, final: true, at }
}
```

- [ ] **Step 5: Write `panel.ts`**

```ts
/**
 * Problem-panel state (spec §6.3): one card per problem the interviewer has shown, with the sections
 * and highlights either side added. Pure, so the provider can check an instruction before applying it.
 */
import type { Author, Example, Section, WireCard } from '../protocol/messages'

export interface PanelHighlight {
  id: string
  quote: string
  occurrence: number
  note?: string
  author: Author
}

export interface ProblemCard {
  itemId: string
  /** Generic, from the agent: "Problem 1". Never the problem's name. */
  label: string
  kind: 'problem' | 'question'
  statement: string
  examples: Example[]
  sections: Section[]
  highlights: PanelHighlight[]
}

export interface PanelState {
  cards: ProblemCard[]
  activeId: string | null
  /** The card whose tab flashes because the interviewer just showed it. */
  flashId: string | null
}

export type PanelAction =
  | { type: 'show'; card: Pick<ProblemCard, 'itemId' | 'label' | 'kind' | 'statement' | 'examples'> }
  | { type: 'add_section'; itemId: string; section: Section }
  | { type: 'highlight'; itemId: string; highlight: PanelHighlight }
  | { type: 'clear_highlight'; highlightId: string }
  | { type: 'select'; itemId: string }
  | { type: 'restore'; cards: ProblemCard[]; activeId: string | null }
  | { type: 'flash_done' }

export const EMPTY_PANEL: PanelState = { cards: [], activeId: null, flashId: null }

export function hasCard(state: PanelState, itemId: string): boolean {
  return state.cards.some((c) => c.itemId === itemId)
}

function mapCard(state: PanelState, itemId: string, fn: (c: ProblemCard) => ProblemCard): PanelState {
  if (!hasCard(state, itemId)) return state
  return { ...state, cards: state.cards.map((c) => (c.itemId === itemId ? fn(c) : c)) }
}

export function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case 'show': {
      const { card } = action
      const cards = hasCard(state, card.itemId)
        ? state.cards.map((c) => (c.itemId === card.itemId ? { ...c, ...card } : c))
        : [...state.cards, { ...card, sections: [], highlights: [] }]
      return { cards, activeId: card.itemId, flashId: card.itemId }
    }
    case 'add_section':
      return mapCard(state, action.itemId, (c) => ({
        ...c,
        sections: [...c.sections.filter((s) => s.id !== action.section.id), action.section],
      }))
    case 'highlight':
      return mapCard(state, action.itemId, (c) => ({
        ...c,
        highlights: [...c.highlights.filter((h) => h.id !== action.highlight.id), action.highlight],
      }))
    case 'clear_highlight':
      return {
        ...state,
        cards: state.cards.map((c) => ({ ...c, highlights: c.highlights.filter((h) => h.id !== action.highlightId) })),
      }
    case 'select':
      return hasCard(state, action.itemId) ? { ...state, activeId: action.itemId } : state
    case 'restore':
      return { cards: action.cards, activeId: action.activeId ?? action.cards.at(-1)?.itemId ?? null, flashId: null }
    case 'flash_done':
      return state.flashId ? { ...state, flashId: null } : state
  }
}

export function cardFromWire(c: WireCard): ProblemCard {
  return {
    itemId: c.item_id,
    label: c.label,
    kind: c.kind,
    statement: c.statement,
    examples: c.examples,
    sections: c.sections,
    highlights: c.highlights.map((h) => ({ id: h.highlight_id, quote: h.quote, occurrence: h.occurrence, note: h.note, author: h.author })),
  }
}

export interface Span {
  start: number
  end: number
}

/** Collapses whitespace runs to one space, remembering where each kept character came from. */
function collapse(s: string): { text: string; map: number[] } {
  let text = ''
  const map: number[] = []
  let inSpace = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (/\s/.test(ch)) {
      if (inSpace) continue
      inSpace = true
      text += ' '
    } else {
      inSpace = false
      text += ch
    }
    map.push(i)
  }
  return { text, map }
}

function nth(haystack: string, needle: string, occurrence: number): number {
  let from = 0
  for (let n = 0; ; n++) {
    const i = haystack.indexOf(needle, from)
    if (i === -1 || n === occurrence) return i
    from = i + 1
  }
}

/** Where the `occurrence`-th (0-based) copy of `quote` sits in `text`: an exact match first, then one
 * that ignores re-flowed whitespace (an LLM often changes line breaks). Null when it isn't there. */
export function findQuote(text: string, quote: string, occurrence = 0): Span | null {
  const q = quote.trim()
  if (!q) return null
  const exact = nth(text, q, occurrence)
  if (exact !== -1) return { start: exact, end: exact + q.length }
  const t = collapse(text)
  const cq = collapse(q).text
  const i = nth(t.text, cq, occurrence)
  if (i === -1) return null
  return { start: t.map[i], end: t.map[i + cq.length - 1] + 1 }
}

/** Which occurrence of `quote` starts at offset `start`, for anchoring the candidate's selection. */
export function occurrenceAt(text: string, quote: string, start: number): number {
  let n = 0
  let i = text.indexOf(quote)
  while (i !== -1 && i < start) {
    n += 1
    i = text.indexOf(quote, i + 1)
  }
  return n
}

export interface TextPiece {
  text: string
  highlight?: PanelHighlight
}

/** Splits `text` into plain and highlighted pieces. On overlap the earlier-starting highlight wins. */
export function markSegments(text: string, highlights: PanelHighlight[]): TextPiece[] {
  const spans = highlights
    .map((h) => ({ h, span: findQuote(text, h.quote, h.occurrence) }))
    .filter((x): x is { h: PanelHighlight; span: Span } => x.span !== null)
    .sort((a, b) => a.span.start - b.span.start)
  const out: TextPiece[] = []
  let pos = 0
  for (const { h, span } of spans) {
    if (span.start < pos) continue
    if (span.start > pos) out.push({ text: text.slice(pos, span.start) })
    out.push({ text: text.slice(span.start, span.end), highlight: h })
    pos = span.end
  }
  if (pos < text.length) out.push({ text: text.slice(pos) })
  return out
}
```

- [ ] **Step 6: Run both tests to verify they pass**

Run: `cd apps/web && pnpm vitest run features/interview-live/session/transcript.test.ts features/interview-live/workspace/panel.test.ts`
Expected: PASS.

---

### Task 3: Code operations and whiteboard helpers

**Files:**
- Create: `apps/web/features/interview-live/workspace/codeOps.ts`
- Create: `apps/web/features/interview-live/workspace/codeOps.test.ts`
- Create: `apps/web/features/interview-live/workspace/board.ts`
- Create: `apps/web/features/interview-live/workspace/board.test.ts`
- Delete: `apps/web/features/interview-live/work/summarizeScene.ts`, `apps/web/features/interview-live/work/summarizeScene.test.ts`
- Modify: `apps/web/features/interview-live/work/DiagramBoard.tsx` (import path only)

**Interfaces:**
- Consumes: `CodeLanguage`, `LineAnchor`, `DrawElement` (Task 1).
- Produces:
  - `codeOps.ts`: `type Language = CodeLanguage`, `LANGUAGES`, `SEARCH_RADIUS = 5`, `MAX_INSERT_LINES = 10`, `commentLines(language, text): string[]`, `starterText(language): string`, `resolveLine(lines: readonly string[], at: LineAnchor): number | null`, `insertionText(language, kind: 'comment' | 'code', text): string | null`, `overlaps(a1, a2, b1, b2): boolean`
  - `board.ts`: `SceneElement`, `Skeleton`, `INTERVIEWER_STROKE = '#ff5c1f'`, `summarizeScene(elements: readonly unknown[]): string`, `selectionSummary(elements, selectedIds: Record<string, boolean>): string`, `sceneVersion(elements): number`, `sceneOrigin(elements): { x: number; y: number }`, `skeletonsFor(elements: DrawElement[], origin): Skeleton[]`

- [ ] **Step 1: Write the failing codeOps test**

Create `apps/web/features/interview-live/workspace/codeOps.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { MAX_INSERT_LINES, commentLines, insertionText, overlaps, resolveLine, starterText } from './codeOps'

const CODE = ['def f(s):', '    seen = {}', '    for c in s:', '        seen[c] = 1', '    return len(seen)']

describe('resolveLine', () => {
  it('lands at the top for "top"', () => {
    expect(resolveLine(CODE, 'top')).toBe(1)
  })

  it('lands on the line when its text still matches (ignoring indentation)', () => {
    expect(resolveLine(CODE, { line: 3, expect: 'for c in s:' })).toBe(3)
  })

  it('follows the line when the candidate added lines above it', () => {
    const moved = ['# notes', '# more notes', ...CODE]
    expect(resolveLine(moved, { line: 3, expect: '    for c in s:' })).toBe(5)
  })

  it('refuses when the line is gone or too far away', () => {
    expect(resolveLine(CODE, { line: 3, expect: 'while True:' })).toBeNull()
    const far = [...Array(7).fill('#'), ...CODE]
    expect(resolveLine(far, { line: 3, expect: 'for c in s:' })).toBeNull()
  })
})

describe('commentLines and insertionText', () => {
  it('uses each language comment syntax', () => {
    expect(commentLines('python', 'Why?')).toEqual(['# Why?'])
    expect(commentLines('java', 'Why?\nAnd?')).toEqual(['// Why?', '// And?'])
    expect(starterText('go')).toBe('// write your solution here\n')
  })

  it('ends every insertion with a newline and limits code inserts', () => {
    expect(insertionText('python', 'comment', 'Edge case?')).toBe('# Edge case?\n')
    expect(insertionText('python', 'code', 'print(f("ab"))\n')).toBe('print(f("ab"))\n')
    const long = Array.from({ length: MAX_INSERT_LINES + 1 }, (_, i) => `x${i} = ${i}`).join('\n')
    expect(insertionText('python', 'code', long)).toBeNull()
  })
})

describe('overlaps', () => {
  it('detects touching line ranges', () => {
    expect(overlaps(1, 2, 2, 4)).toBe(true)
    expect(overlaps(5, 6, 2, 4)).toBe(false)
  })
})
```

- [ ] **Step 2: Write the failing board test**

Create `apps/web/features/interview-live/workspace/board.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { INTERVIEWER_STROKE, sceneOrigin, sceneVersion, selectionSummary, skeletonsFor, summarizeScene } from './board'

const SCENE = [
  { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 100, height: 50, version: 2 },
  { id: 't1', type: 'text', text: 'Client', containerId: 'r1', version: 1 },
  { id: 'r2', type: 'rectangle', x: 300, y: 0, width: 100, height: 50, version: 1, customData: { author: 'interviewer' } },
  { id: 't2', type: 'text', text: 'API', containerId: 'r2', version: 1 },
  { id: 'a1', type: 'arrow', startBinding: { elementId: 'r1' }, endBinding: { elementId: 'r2' }, version: 1 },
  { id: 'x', type: 'ellipse', isDeleted: true, version: 9 },
]

describe('summarizeScene', () => {
  it('names shapes by their labels and resolves arrow ends', () => {
    expect(summarizeScene(SCENE)).toBe('rectangle "Client"\nrectangle "API" (interviewer)\narrow Client → API')
  })

  it('says when the board is empty', () => {
    expect(summarizeScene([])).toBe('(empty whiteboard)')
  })

  it('summarizes only the selected shapes and their labels', () => {
    expect(selectionSummary(SCENE, { r1: true })).toBe('rectangle "Client"')
  })
})

describe('sceneVersion and sceneOrigin', () => {
  it('changes when live elements change and ignores deleted ones', () => {
    expect(sceneVersion(SCENE)).toBe(6 + 5)
  })

  it('places new drawings to the right of existing ones', () => {
    expect(sceneOrigin([])).toEqual({ x: 0, y: 0 })
    expect(sceneOrigin(SCENE)).toEqual({ x: 480, y: 0 })
  })
})

describe('skeletonsFor', () => {
  it('lays shapes out in a row in the interviewer colour and binds arrows by id', () => {
    const out = skeletonsFor(
      [
        { type: 'rectangle', id: 'n1', label: 'Client' },
        { type: 'ellipse', id: 'n2' },
        { type: 'arrow', id: 'e1', from: 'n1', to: 'n2', label: 'call' },
        { type: 'text', id: 't', label: 'note', x: 10, y: 200 },
      ],
      { x: 500, y: 20 },
    )
    expect(out[0]).toMatchObject({ type: 'rectangle', id: 'n1', x: 500, y: 20, strokeColor: INTERVIEWER_STROKE, label: { text: 'Client' } })
    expect(out[1]).toMatchObject({ type: 'ellipse', x: 740, y: 20 })
    expect(out[2]).toMatchObject({ type: 'arrow', start: { id: 'n1' }, end: { id: 'n2' }, label: { text: 'call' } })
    expect(out[3]).toMatchObject({ type: 'text', text: 'note', x: 510, y: 220 })
  })
})
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `cd apps/web && pnpm vitest run features/interview-live/workspace/codeOps.test.ts features/interview-live/workspace/board.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Write `codeOps.ts`**

```ts
/**
 * Pure helpers for the interviewer's code instructions (spec §6.4): where an instruction lands, and
 * the text it inserts. The editor adapter (work/codeApi.ts) applies them to Monaco.
 */
import type { CodeLanguage, LineAnchor } from '../protocol/messages'

export type Language = CodeLanguage

export const LANGUAGES: readonly Language[] = ['python', 'javascript', 'typescript', 'java', 'cpp', 'go']
/** How far (in lines) an instruction looks for its expected line after the candidate edited above it. */
export const SEARCH_RADIUS = 5
export const MAX_INSERT_LINES = 10

const LINE_COMMENT: Record<Language, string> = {
  python: '#', javascript: '//', typescript: '//', java: '//', cpp: '//', go: '//',
}

export function commentLines(language: Language, text: string): string[] {
  const mark = LINE_COMMENT[language]
  return text.split('\n').map((line) => (line.trim() ? `${mark} ${line.trim()}` : mark))
}

export function starterText(language: Language): string {
  return `${commentLines(language, 'write your solution here').join('\n')}\n`
}

/** The 1-based line an instruction lands above, or null when its expected line can't be found
 * within SEARCH_RADIUS (the candidate changed it): then the browser refuses the instruction. */
export function resolveLine(lines: readonly string[], at: LineAnchor): number | null {
  if (at === 'top') return 1
  const want = at.expect.trim()
  const matches = (i: number) => i >= 0 && i < lines.length && lines[i].trim() === want
  const idx = at.line - 1
  if (matches(idx)) return at.line
  for (let d = 1; d <= SEARCH_RADIUS; d++) {
    if (matches(idx - d)) return idx - d + 1
    if (matches(idx + d)) return idx + d + 1
  }
  return null
}

/** Text to insert above the resolved line: comment-prefixed for comments, verbatim for code, always
 * ending in a newline. Null when a code insert is longer than MAX_INSERT_LINES. */
export function insertionText(language: Language, kind: 'comment' | 'code', text: string): string | null {
  const body = kind === 'comment' ? commentLines(language, text) : text.replace(/\n+$/, '').split('\n')
  if (kind === 'code' && body.length > MAX_INSERT_LINES) return null
  return `${body.join('\n')}\n`
}

/** Whether line range [a1, a2] touches [b1, b2]. */
export function overlaps(a1: number, a2: number, b1: number, b2: number): boolean {
  return a1 <= b2 && b1 <= a2
}
```

- [ ] **Step 5: Write `board.ts`**

```ts
/**
 * Pure whiteboard helpers: the text summary the agent reads (spec §6.2 `board.summary`), and the
 * Excalidraw element skeletons for the interviewer's `board.draw`. No Excalidraw import, so this
 * stays testable without the browser-only library.
 */
import type { DrawElement } from '../protocol/messages'

export interface SceneElement {
  id: string
  type: string
  x?: number
  y?: number
  width?: number
  height?: number
  text?: string
  isDeleted?: boolean
  containerId?: string | null
  startBinding?: { elementId?: string } | null
  endBinding?: { elementId?: string } | null
  customData?: Record<string, unknown>
  version?: number
}

export type Skeleton = Record<string, unknown>

/** The brand orange, hsl(16.3 100% 56.1%): interviewer marks on the whiteboard. */
export const INTERVIEWER_STROKE = '#ff5c1f'

const SHAPE_W = 180
const SHAPE_H = 80
const GAP = 60

const live = (elements: readonly unknown[]) =>
  (elements as SceneElement[]).filter((e) => e && e.type && !e.isDeleted)

export function summarizeScene(elements: readonly unknown[]): string {
  const els = live(elements)
  if (!els.length) return '(empty whiteboard)'
  const labelOf = new Map<string, string>()
  for (const e of els) if (e.type === 'text' && e.containerId && e.text) labelOf.set(e.containerId, e.text)
  const name = (id?: string) => (id ? labelOf.get(id) ?? `#${id.slice(0, 6)}` : '?')
  const lines: string[] = []
  for (const e of els) {
    if (e.type === 'text') {
      if (!e.containerId && e.text) lines.push(`text "${e.text}"`)
      continue
    }
    const by = e.customData?.author === 'interviewer' ? ' (interviewer)' : ''
    if (e.type === 'arrow' || e.type === 'line') {
      lines.push(`${e.type} ${name(e.startBinding?.elementId)} → ${name(e.endBinding?.elementId)}${by}`)
    } else {
      const label = labelOf.get(e.id)
      lines.push(`${e.type}${label ? ` "${label}"` : ''}${by}`)
    }
  }
  return lines.join('\n')
}

/** The summary of just the shapes the candidate selected (with their bound labels), for Ask. */
export function selectionSummary(elements: readonly unknown[], selectedIds: Record<string, boolean>): string {
  const picked = live(elements).filter((e) => selectedIds[e.id] || (e.containerId && selectedIds[e.containerId]))
  return summarizeScene(picked)
}

/** Changes whenever a live element changes; used to skip unchanged backups. */
export function sceneVersion(elements: readonly unknown[]): number {
  const els = live(elements)
  return els.reduce((n, e) => n + (e.version ?? 0), 0) + els.length
}

/** Where new interviewer drawings go: to the right of everything already drawn. */
export function sceneOrigin(elements: readonly unknown[]): { x: number; y: number } {
  const els = live(elements).filter((e) => typeof e.x === 'number')
  if (!els.length) return { x: 0, y: 0 }
  const right = Math.max(...els.map((e) => (e.x ?? 0) + (e.width ?? 0)))
  const top = Math.min(...els.map((e) => e.y ?? 0))
  return { x: right + 80, y: top }
}

/** Excalidraw element skeletons for `board.draw`: shapes in a row from `origin` unless placed, in the
 * interviewer colour; arrows bind to shapes by id (convertToExcalidrawElements resolves them). */
export function skeletonsFor(elements: DrawElement[], origin: { x: number; y: number }): Skeleton[] {
  let col = 0
  const place = (e: DrawElement) => {
    if (e.x !== undefined && e.y !== undefined) return { x: origin.x + e.x, y: origin.y + e.y }
    const p = { x: origin.x + col * (SHAPE_W + GAP), y: origin.y }
    col += 1
    return p
  }
  return elements.map((e) => {
    const base = { id: e.id, strokeColor: INTERVIEWER_STROKE }
    if (e.type === 'arrow') {
      return {
        ...base, type: 'arrow', x: origin.x, y: origin.y + SHAPE_H + GAP,
        ...(e.from ? { start: { id: e.from } } : {}),
        ...(e.to ? { end: { id: e.to } } : {}),
        ...(e.label ? { label: { text: e.label } } : {}),
      }
    }
    const p = place(e)
    if (e.type === 'text') return { ...base, type: 'text', x: p.x, y: p.y, text: e.label ?? '' }
    return {
      ...base, type: e.type, x: p.x, y: p.y, width: SHAPE_W, height: SHAPE_H,
      ...(e.label ? { label: { text: e.label } } : {}),
    }
  })
}
```

- [ ] **Step 6: Move the old summary out of `work/`**

Delete `apps/web/features/interview-live/work/summarizeScene.ts` and `apps/web/features/interview-live/work/summarizeScene.test.ts`. In `apps/web/features/interview-live/work/DiagramBoard.tsx` replace:

```ts
import { summarizeScene } from './summarizeScene'
```

with:

```ts
import { summarizeScene } from '../workspace/board'
```

- [ ] **Step 7: Run both tests to verify they pass**

Run: `cd apps/web && pnpm vitest run features/interview-live/workspace/codeOps.test.ts features/interview-live/workspace/board.test.ts`
Expected: PASS.

---

### Task 4: Proctor ledger, screen share and Esc lock

**Files:**
- Create: `apps/web/features/interview-live/proctor/ledger.ts`
- Create: `apps/web/features/interview-live/proctor/ledger.test.ts`
- Create: `apps/web/features/interview-live/proctor/screenShare.ts`
- Create: `apps/web/features/interview-live/proctor/screenShare.test.ts`
- Create: `apps/web/features/interview-live/proctor/keyboardLock.ts`
- Create: `apps/web/features/interview-live/proctor/keyboardLock.test.ts`

**Interfaces:**
- Consumes: `ProctorKind` (Task 1).
- Produces:
  - `ledger.ts`: `WEIGHT`, `COUNTER`, `MERGE_WINDOW_MS = 1500`, `LedgerEntry { kind; weight: 1 | 0.5; at }`, `Ledger { entries; tabChanges; screenChanges; fullViolations }`, `LedgerChange = { kind: 'added' | 'upgraded' | 'merged' }`, `EMPTY_LEDGER`, `recordEvent(ledger, kind, at): { ledger; change }`, `formatWeighted(n): string`
  - `screenShare.ts`: `ShareResult`, `requestEntireScreen(): Promise<ShareResult>`, `stopScreenShare(): void`, `isScreenShared(): boolean`, `isPrompting(): boolean`, `useScreenShared(): boolean`
  - `keyboardLock.ts`: `lockEscape(): Promise<boolean>`, `unlockKeys(): void`, `enterFullscreen(): Promise<void>`

- [ ] **Step 1: Write the failing ledger test**

Create `apps/web/features/interview-live/proctor/ledger.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { EMPTY_LEDGER, MERGE_WINDOW_MS, formatWeighted, recordEvent, type Ledger } from './ledger'
import type { ProctorKind } from '../protocol/messages'

function play(events: [ProctorKind, number][]): { ledger: Ledger; changes: string[] } {
  let ledger = EMPTY_LEDGER
  const changes: string[] = []
  for (const [kind, at] of events) {
    const r = recordEvent(ledger, kind, at)
    ledger = r.ledger
    changes.push(r.change.kind)
  }
  return { ledger, changes }
}

describe('recordEvent', () => {
  it('counts one tab switch once, even when it also blurs the window and drops full screen', () => {
    const { ledger, changes } = play([['window_blur', 1000], ['tab_hidden', 1020], ['fullscreen_exit', 1040]])
    expect(changes).toEqual(['added', 'upgraded', 'merged'])
    expect(ledger.entries).toEqual([{ kind: 'tab_hidden', weight: 1, at: 1000 }])
    expect(ledger).toMatchObject({ tabChanges: 1, screenChanges: 0, fullViolations: 1 })
  })

  it('counts separate actions separately', () => {
    const { ledger } = play([['tab_hidden', 0], ['tab_hidden', MERGE_WINDOW_MS + 1]])
    expect(ledger.tabChanges).toBe(2)
  })

  it('weights leaving full screen and stopping the share at one half, never as full violations', () => {
    const { ledger } = play([['fullscreen_exit', 0], ['share_stopped', 5000]])
    expect(ledger).toMatchObject({ tabChanges: 0, screenChanges: 1, fullViolations: 0 })
  })

  it('counts window and display changes as full screen changes', () => {
    const { ledger } = play([['window_blur', 0], ['external_display', 5000], ['fullscreen_exit', 9000]])
    expect(ledger).toMatchObject({ screenChanges: 2.5, fullViolations: 2 })
  })
})

describe('formatWeighted', () => {
  it('pads whole numbers like the HUD and keeps halves', () => {
    expect(formatWeighted(0)).toBe('00')
    expect(formatWeighted(2)).toBe('02')
    expect(formatWeighted(0.5)).toBe('0.5')
    expect(formatWeighted(1.5)).toBe('1.5')
  })
})
```

- [ ] **Step 2: Write the failing screen-share and keyboard-lock tests**

Create `apps/web/features/interview-live/proctor/screenShare.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isPrompting, isScreenShared, requestEntireScreen, stopScreenShare } from './screenShare'

function fakeShare(surface: string | undefined) {
  let ended: (() => void) | undefined
  const track = {
    kind: 'video',
    stop: vi.fn(),
    getSettings: () => (surface ? { displaySurface: surface } : {}),
    addEventListener: (type: string, cb: () => void) => { if (type === 'ended') ended = cb },
  }
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] }
  return { stream, track, end: () => ended?.() }
}

function mockDisplayMedia(impl: () => Promise<unknown>) {
  Object.assign(navigator.mediaDevices, { getDisplayMedia: vi.fn(impl) })
}

afterEach(() => {
  stopScreenShare()
  Reflect.deleteProperty(navigator.mediaDevices, 'getDisplayMedia')
})

describe('requestEntireScreen', () => {
  it('accepts an entire-screen share and tracks it until it ends', async () => {
    const share = fakeShare('monitor')
    mockDisplayMedia(async () => share.stream)
    expect(await requestEntireScreen()).toEqual({ ok: true })
    expect(isScreenShared()).toBe(true)
    share.end()
    expect(isScreenShared()).toBe(false)
  })

  it('refuses a window or tab share and stops it', async () => {
    const share = fakeShare('window')
    mockDisplayMedia(async () => share.stream)
    expect(await requestEntireScreen()).toEqual({ ok: false, reason: 'not_entire_screen' })
    expect(share.track.stop).toHaveBeenCalled()
    expect(isScreenShared()).toBe(false)
  })

  it('reports a denied prompt and a browser without screen sharing', async () => {
    mockDisplayMedia(async () => { throw new Error('NotAllowedError') })
    expect(await requestEntireScreen()).toEqual({ ok: false, reason: 'denied' })
    Reflect.deleteProperty(navigator.mediaDevices, 'getDisplayMedia')
    expect(await requestEntireScreen()).toEqual({ ok: false, reason: 'unsupported' })
  })

  it('is prompting only while the picker is open', async () => {
    let resolve: (s: unknown) => void = () => {}
    mockDisplayMedia(() => new Promise((r) => { resolve = r }))
    const pending = requestEntireScreen()
    expect(isPrompting()).toBe(true)
    resolve(fakeShare('monitor').stream)
    await pending
    expect(isPrompting()).toBe(false)
  })
})
```

Create `apps/web/features/interview-live/proctor/keyboardLock.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enterFullscreen, lockEscape } from './keyboardLock'

afterEach(() => { Reflect.deleteProperty(navigator, 'keyboard') })

describe('keyboard lock', () => {
  it('locks Escape where the Keyboard Lock API exists', async () => {
    const lock = vi.fn(async () => {})
    Object.defineProperty(navigator, 'keyboard', { configurable: true, value: { lock, unlock: vi.fn() } })
    expect(await lockEscape()).toBe(true)
    expect(lock).toHaveBeenCalledWith(['Escape'])
  })

  it('does nothing elsewhere', async () => {
    expect(await lockEscape()).toBe(false)
  })

  it('enters full screen before locking', async () => {
    await enterFullscreen()
    expect(document.documentElement.requestFullscreen).toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/web && pnpm vitest run features/interview-live/proctor/ledger.test.ts features/interview-live/proctor/screenShare.test.ts features/interview-live/proctor/keyboardLock.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Write `ledger.ts`**

```ts
/**
 * The proctoring ledger (spec §7). One candidate action often fires several browser signals (a tab
 * switch blurs the window, hides the tab and can drop full screen); signals within MERGE_WINDOW_MS of
 * the action's first signal merge into one entry at the heaviest kind.
 */
import { padCount } from '@/components/hud/Count'
import type { ProctorKind } from '../protocol/messages'

export const WEIGHT: Record<ProctorKind, 1 | 0.5> = {
  tab_hidden: 1, window_blur: 1, external_display: 1, fullscreen_exit: 0.5, share_stopped: 0.5,
}
export const COUNTER: Record<ProctorKind, 'tab' | 'screen'> = {
  tab_hidden: 'tab', window_blur: 'screen', external_display: 'screen', fullscreen_exit: 'screen', share_stopped: 'screen',
}
/** Which kind names a merged action: a tab switch beats the window blur it also caused. */
const RANK: Record<ProctorKind, number> = {
  tab_hidden: 5, external_display: 4, window_blur: 3, share_stopped: 2, fullscreen_exit: 1,
}
export const MERGE_WINDOW_MS = 1500

export interface LedgerEntry {
  kind: ProctorKind
  weight: 1 | 0.5
  at: number
}

export interface Ledger {
  entries: LedgerEntry[]
  tabChanges: number
  /** Weighted: full-screen exits and stopped shares count one half. */
  screenChanges: number
  /** Full-weight violations; these drive the interviewer's end rule. */
  fullViolations: number
}

export type LedgerChange = { kind: 'added' } | { kind: 'upgraded' } | { kind: 'merged' }

export const EMPTY_LEDGER: Ledger = { entries: [], tabChanges: 0, screenChanges: 0, fullViolations: 0 }

function tally(entries: LedgerEntry[]): Ledger {
  let tabChanges = 0
  let screenChanges = 0
  let fullViolations = 0
  for (const e of entries) {
    if (COUNTER[e.kind] === 'tab') tabChanges += 1
    else screenChanges += e.weight
    if (e.weight === 1) fullViolations += 1
  }
  return { entries, tabChanges, screenChanges, fullViolations }
}

export function recordEvent(ledger: Ledger, kind: ProctorKind, at: number): { ledger: Ledger; change: LedgerChange } {
  const last = ledger.entries[ledger.entries.length - 1]
  if (last && at - last.at <= MERGE_WINDOW_MS) {
    if (RANK[kind] <= RANK[last.kind]) return { ledger, change: { kind: 'merged' } }
    const entries = [...ledger.entries.slice(0, -1), { kind, weight: WEIGHT[kind], at: last.at }]
    return { ledger: tally(entries), change: { kind: 'upgraded' } }
  }
  return { ledger: tally([...ledger.entries, { kind, weight: WEIGHT[kind], at }]), change: { kind: 'added' } }
}

/** "00", "02" like the HUD's counts; halves as "0.5", "1.5". */
export function formatWeighted(n: number): string {
  return Number.isInteger(n) ? padCount(n) : n.toFixed(1)
}
```

- [ ] **Step 5: Write `screenShare.ts`**

```ts
'use client'
/**
 * The entire-screen share the room requires (spec §7). Acquired at the checks, kept active for the
 * round and checked, but never published to the room. Module state, so the checks and the live view
 * share one stream.
 */
import { useSyncExternalStore } from 'react'

export type ShareResult = { ok: true } | { ok: false; reason: 'denied' | 'not_entire_screen' | 'unsupported' }

let stream: MediaStream | null = null
let prompting = false
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function isScreenShared(): boolean {
  return stream !== null
}

/** True while the browser's share picker is open: the window blur it causes isn't a violation. */
export function isPrompting(): boolean {
  return prompting
}

export async function requestEntireScreen(): Promise<ShareResult> {
  const devices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices
  if (!devices?.getDisplayMedia) return { ok: false, reason: 'unsupported' }
  let next: MediaStream
  prompting = true
  try {
    next = await devices.getDisplayMedia({
      video: { displaySurface: 'monitor' },
      audio: false,
      monitorTypeSurfaces: 'include',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'exclude',
    } as DisplayMediaStreamOptions)
  } catch {
    return { ok: false, reason: 'denied' }
  } finally {
    prompting = false
  }
  const track = next.getVideoTracks()[0]
  const surface = (track?.getSettings() as { displaySurface?: string } | undefined)?.displaySurface
  // Browsers that don't report the surface are trusted; Chrome and Edge always report it.
  if (!track || (surface !== undefined && surface !== 'monitor')) {
    next.getTracks().forEach((t) => t.stop())
    return { ok: false, reason: 'not_entire_screen' }
  }
  stream?.getTracks().forEach((t) => t.stop())
  stream = next
  track.addEventListener('ended', () => {
    if (stream !== next) return
    stream = null
    notify()
  })
  notify()
  return { ok: true }
}

export function stopScreenShare(): void {
  if (!stream) return
  stream.getTracks().forEach((t) => t.stop())
  stream = null
  notify()
}

export function useScreenShared(): boolean {
  return useSyncExternalStore(subscribe, isScreenShared, () => false)
}
```

- [ ] **Step 6: Write `keyboardLock.ts`**

```ts
/**
 * Chromium's Keyboard Lock API: while the room is full screen, Esc must be held to leave it, so a
 * stray tap isn't a violation (spec §7). Does nothing in browsers without it.
 */
type KeyboardLock = { lock?: (codes?: string[]) => Promise<void>; unlock?: () => void }

function keyboard(): KeyboardLock | undefined {
  return typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard
}

export async function lockEscape(): Promise<boolean> {
  const kb = keyboard()
  if (!kb?.lock) return false
  try {
    await kb.lock(['Escape'])
    return true
  } catch {
    return false
  }
}

export function unlockKeys(): void {
  try {
    keyboard()?.unlock?.()
  } catch {
    // not supported
  }
}

/** Full screen, then the Esc lock (it only holds while the page is full screen). */
export async function enterFullscreen(): Promise<void> {
  await document.documentElement.requestFullscreen()
  await lockEscape()
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd apps/web && pnpm vitest run features/interview-live/proctor/ledger.test.ts features/interview-live/proctor/screenShare.test.ts features/interview-live/proctor/keyboardLock.test.ts`
Expected: PASS.

---

### Task 5: Switch the live session to protocol v2

This task replaces the seam in one move and keeps the room compiling: new `LiveSession` interface, state machine, provider, fake, LiveKit adapter and `useProctor`, plus small edits to the components that used the old seam. Later tasks replace those components wholesale.

**Files:**
- Modify (rewrite): `apps/web/features/interview-live/session/types.ts`
- Modify (rewrite): `apps/web/features/interview-live/session/machine.ts`
- Modify (rewrite): `apps/web/features/interview-live/session/LiveSessionProvider.tsx`
- Modify (rewrite): `apps/web/features/interview-live/session/MockLiveSession.ts`
- Modify (rewrite): `apps/web/features/interview-live/session/LiveKitLiveSession.ts`
- Modify (rewrite): `apps/web/features/interview-live/proctor/useProctor.ts`
- Modify: `apps/web/features/interview-live/work/CodeEditor.tsx`, `DiagramBoard.tsx`, `TranscriptPanel.tsx`
- Modify: `apps/web/app/(app)/interviews/[sessionId]/live/_components/LiveInterview.tsx`, `LiveView.tsx`, `EndedView.tsx`
- Delete: `proctor/ViolationOverlay.tsx`, `proctor/ViolationOverlay.test.tsx`, `session/types.test.ts`, `session/machine.reconnecting.test.ts`, `session/LiveSessionProvider.reconnect.test.tsx`, `_components/LiveInterview.remount.test.tsx`, `_components/LiveView.test.tsx`, `_components/LiveView.end.test.tsx` (old seam, pause flow and old layout; Tasks 12 and 15 add the new LiveView tests)
- Test (rewrite): `session/machine.test.ts`, `session/LiveSessionProvider.test.tsx`, `session/MockLiveSession.test.ts`, `session/LiveKitLiveSession.test.ts`, `proctor/useProctor.test.tsx`; update `work/CodeEditor.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`stampWeb`, `parseAgentMessage`, `WORKSPACE_TOPIC`, `BYTE_TOPICS`, types), Task 2 (`TranscriptSegment`, `applySegment`, `systemNote`), Task 4 (`EMPTY_LEDGER`, `MERGE_WINDOW_MS`, `recordEvent`, `Ledger`, `useScreenShared`, `isPrompting`, `stopScreenShare`).
- Produces:
  - `types.ts`: `ConnState`, `AgentState = 'absent' | 'initializing' | 'listening' | 'thinking' | 'speaking'`, `BytesKind = 'board.snapshot' | 'board.backup'`, `LiveSession { connect; disconnect; connectionState; getLocalStream; setMicEnabled; setCameraEnabled; send(body): string; sendBytes(kind, data, attributes?): Promise<void>; onMessage; onBoardRestore; onTranscript; onAgentState; onConnectionChange }` (every `on*` returns `() => void`)
  - `machine.ts`: `LiveState` (no `paused`), `LiveEvent` (`ENDED` carries `reason: EndReason; message?: string`), `LiveContext { endedReason: EndReason | null; endedMessage: string | null }`, `initialMachine`, `transition`
  - `LiveSessionProvider.tsx`: `END_FALLBACK_MS = 5000`; context `{ session, state, ctx, send, transcript: TranscriptSegment[], agentState, addNote(text), requestEnd() }`; `useLiveSession()`
  - `MockLiveSession`: `sent`, `bytes`, `micEnabled`, `sentOf(type)`, `emitMessage`, `emitBoardRestore`, `emitTranscript`, `emitAgentState`, `simulateConnection`, protected hooks `handleSent(m)`, `handleBytes(kind, data, attributes)`, `setConn(s)`
  - `useProctor({ session, enabled }): ProctorState { ledger; outOfFullscreen; shareStopped; toast }`, `WARNING_TEXT`, `TOAST_MS = 4000`

- [ ] **Step 1: Write the failing machine test**

Replace `apps/web/features/interview-live/session/machine.test.ts` with:

```ts
import { describe, expect, it } from 'vitest'
import { initialMachine, transition, type LiveEvent, type LiveState } from './machine'

function run(events: LiveEvent[], from = initialMachine()) {
  return events.reduce((s, e) => transition(s.state, s.ctx, e), from)
}
const at = (state: LiveState) => ({ state, ctx: initialMachine().ctx })

describe('live machine', () => {
  it('walks prejoin → checks → connecting → live → ending → ended', () => {
    const s = run([{ type: 'START_CHECKS' }, { type: 'CHECKS_PASSED' }, { type: 'CONNECTED' }, { type: 'END' }, { type: 'ENDED', reason: 'candidate_ended' }])
    expect(s.state).toBe('ended')
    expect(s.ctx).toEqual({ endedReason: 'candidate_ended', endedMessage: null })
  })

  it('ends straight from live with the interviewer reason and message', () => {
    const s = run([{ type: 'ENDED', reason: 'ended_by_interviewer', message: 'Repeated tab switching.' }], at('live'))
    expect(s.ctx).toEqual({ endedReason: 'ended_by_interviewer', endedMessage: 'Repeated tab switching.' })
  })

  it('returns to live after reconnecting and can end from there', () => {
    expect(run([{ type: 'RECONNECTING' }, { type: 'RECONNECTED' }], at('live')).state).toBe('live')
    expect(run([{ type: 'RECONNECTING' }, { type: 'ENDED', reason: 'technical' }], at('live')).state).toBe('ended')
  })

  it('ignores ENDED while connecting: a failed connect surfaces as ERROR', () => {
    expect(run([{ type: 'ENDED', reason: 'technical' }], at('connecting')).state).toBe('connecting')
    expect(run([{ type: 'ERROR' }], at('connecting')).state).toBe('error')
  })

  it('keeps the first ending: later ENDED and ERROR do not change an ended round', () => {
    const ended = run([{ type: 'ENDED', reason: 'completed' }], at('live'))
    expect(run([{ type: 'ENDED', reason: 'technical' }, { type: 'ERROR' }], ended)).toEqual(ended)
  })

  it('ignores illegal events', () => {
    expect(run([{ type: 'CONNECTED' }]).state).toBe('prejoin')
  })
})
```

- [ ] **Step 2: Write the failing provider test**

Replace `apps/web/features/interview-live/session/LiveSessionProvider.test.tsx` with:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { stampAgent } from '../protocol/messages'
import { END_FALLBACK_MS, LiveSessionProvider, useLiveSession } from './LiveSessionProvider'
import { MockLiveSession } from './MockLiveSession'

type Ctx = ReturnType<typeof useLiveSession>
function mount(session: MockLiveSession) {
  const ref: { current: Ctx | null } = { current: null }
  function Probe() {
    ref.current = useLiveSession()
    return null
  }
  render(<LiveSessionProvider sessionId="s1" session={session}><Probe /></LiveSessionProvider>)
  const goLive = () => act(() => {
    ref.current!.send({ type: 'START_CHECKS' })
    ref.current!.send({ type: 'CHECKS_PASSED' })
    ref.current!.send({ type: 'CONNECTED' })
  })
  return { ref, goLive }
}

afterEach(() => { vi.useRealTimers() })

describe('LiveSessionProvider', () => {
  it('collects transcript segments and the agent state', () => {
    const session = new MockLiveSession()
    const { ref } = mount(session)
    act(() => {
      session.emitTranscript({ id: 'a', speaker: 'interviewer', text: 'Hi', final: false, at: 1 })
      session.emitTranscript({ id: 'a', speaker: 'interviewer', text: 'Hi there', final: true, at: 2 })
      session.emitAgentState('speaking')
      ref.current!.addNote('Tab change logged')
    })
    expect(ref.current!.transcript.map((s) => s.text)).toEqual(['Hi there', 'Tab change logged'])
    expect(ref.current!.agentState).toBe('speaking')
  })

  it('ends with the interviewer reason and message on session.ending', () => {
    const session = new MockLiveSession()
    const { ref, goLive } = mount(session)
    goLive()
    act(() => session.emitMessage(stampAgent({ type: 'session.ending', reason: 'ended_by_interviewer', message: 'Repeated tab switching.' })))
    expect(ref.current!.state).toBe('ended')
    expect(ref.current!.ctx).toEqual({ endedReason: 'ended_by_interviewer', endedMessage: 'Repeated tab switching.' })
  })

  it('ends as technical when the connection drops during the round', () => {
    const session = new MockLiveSession()
    const { ref, goLive } = mount(session)
    goLive()
    act(() => session.simulateConnection('disconnected'))
    expect(ref.current!.ctx.endedReason).toBe('technical')
  })

  it('requestEnd asks the interviewer to end, and ends locally if it never answers', () => {
    vi.useFakeTimers()
    const session = new MockLiveSession()
    const { ref, goLive } = mount(session)
    goLive()
    act(() => ref.current!.requestEnd())
    expect(ref.current!.state).toBe('ending')
    expect(session.sentOf('session.end_request')).toHaveLength(1)
    act(() => { vi.advanceTimersByTime(END_FALLBACK_MS) })
    expect(ref.current!.state).toBe('ended')
    expect(ref.current!.ctx.endedReason).toBe('candidate_ended')
  })

  it('never labels a disconnect after End as technical', () => {
    const session = new MockLiveSession()
    const { ref, goLive } = mount(session)
    goLive()
    act(() => ref.current!.requestEnd())
    act(() => session.simulateConnection('disconnected'))
    expect(ref.current!.ctx.endedReason).toBe('candidate_ended')
  })
})
```

- [ ] **Step 3: Write the failing fake-session and LiveKit-adapter tests**

Replace `apps/web/features/interview-live/session/MockLiveSession.test.ts` with:

```ts
import { describe, expect, it } from 'vitest'
import { stampAgent } from '../protocol/messages'
import { MockLiveSession } from './MockLiveSession'

describe('MockLiveSession', () => {
  it('connects with local media and reports the agent listening', async () => {
    const s = new MockLiveSession()
    const states: string[] = []
    s.onAgentState((a) => states.push(a))
    await s.connect('s1')
    expect(s.connectionState).toBe('connected')
    expect(s.getLocalStream()).not.toBeNull()
    expect(states).toEqual(['listening'])
  })

  it('stamps and records what the room sends', async () => {
    const s = new MockLiveSession()
    const id = s.send({ type: 'workspace.hello', has_content: false })
    await s.sendBytes('board.snapshot', new Uint8Array([1]), { request_id: 'r' })
    expect(s.sentOf('workspace.hello')[0]).toMatchObject({ v: 1, id, has_content: false })
    expect(s.bytes[0]).toMatchObject({ kind: 'board.snapshot', attributes: { request_id: 'r' } })
  })

  it('plays the agent side to subscribers and stops after unsubscribe', () => {
    const s = new MockLiveSession()
    const got: string[] = []
    const off = s.onMessage((m) => got.push(m.type))
    s.emitMessage(stampAgent({ type: 'panel.clear_highlight', highlight_id: 'h' }))
    off()
    s.emitMessage(stampAgent({ type: 'panel.clear_highlight', highlight_id: 'h' }))
    expect(got).toEqual(['panel.clear_highlight'])
  })

  it('disconnects once', async () => {
    const s = new MockLiveSession()
    const seen: string[] = []
    s.onConnectionChange((c) => seen.push(c))
    await s.connect('s1')
    await s.disconnect()
    await s.disconnect()
    expect(seen.filter((c) => c === 'disconnected')).toHaveLength(1)
  })
})
```

Replace `apps/web/features/interview-live/session/LiveKitLiveSession.test.ts` with:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  on: {} as Record<string, (...a: unknown[]) => void>,
  text: {} as Record<string, (reader: unknown, participant: { identity: string }) => unknown>,
  bytes: {} as Record<string, (reader: unknown, participant: { identity: string }) => unknown>,
  writer: { write: vi.fn(async () => {}), close: vi.fn(async () => {}) },
}))
const sendText = vi.fn(async () => ({}))
const streamBytes = vi.fn(async () => h.writer)
const connect = vi.fn(async () => {})

vi.mock('livekit-client', () => ({
  Room: class {
    localParticipant = {
      identity: 'cand',
      trackPublications: new Map([['mic', { trackSid: 'TR_cand' }]]),
      sendText, streamBytes,
      setMicrophoneEnabled: vi.fn(async () => {}),
    }
    remoteParticipants = new Map()
    on(event: string, cb: (...a: unknown[]) => void) { h.on[event] = cb; return this }
    registerTextStreamHandler(topic: string, cb: (r: unknown, p: { identity: string }) => unknown) { h.text[topic] = cb }
    registerByteStreamHandler(topic: string, cb: (r: unknown, p: { identity: string }) => unknown) { h.bytes[topic] = cb }
    connect = connect
    disconnect = vi.fn(async () => {})
    startAudio = vi.fn(async () => {})
  },
  RoomEvent: {
    ConnectionStateChanged: 'connectionStateChanged', TrackSubscribed: 'trackSubscribed',
    ParticipantConnected: 'participantConnected', ParticipantDisconnected: 'participantDisconnected',
    ParticipantAttributesChanged: 'participantAttributesChanged',
  },
  ConnectionState: { Connecting: 'connecting', Connected: 'connected', Reconnecting: 'reconnecting', SignalReconnecting: 'signalReconnecting', Disconnected: 'disconnected' },
  Track: { Kind: { Audio: 'audio', Video: 'video' } },
}))
vi.mock('@/features/interview/api', () => ({
  goLive: vi.fn(async () => ({ livekitUrl: 'wss://x', token: 'jwt', roomName: 'interview-s1', status: 'LIVE_IN_PROGRESS' })),
}))

import { LiveKitLiveSession } from './LiveKitLiveSession'
import type { TranscriptSegment } from './transcript'

function reader(chunks: string[], attributes: Record<string, string> = {}) {
  return {
    info: { id: 'stream-1', attributes },
    readAll: async () => chunks.join(''),
    async *[Symbol.asyncIterator]() { for (const c of chunks) yield c },
  }
}

describe('LiveKitLiveSession', () => {
  beforeEach(() => {
    for (const k of Object.keys(h.on)) delete h.on[k]
    vi.clearAllMocks()
  })

  it('connects and reports connected', async () => {
    const s = new LiveKitLiveSession()
    await s.connect('s1')
    expect(connect).toHaveBeenCalledWith('wss://x', 'jwt')
    expect(s.connectionState).toBe('connected')
  })

  it('delivers valid workspace messages and drops anything else', async () => {
    const s = new LiveKitLiveSession()
    const got: string[] = []
    s.onMessage((m) => got.push(m.type))
    await s.connect('s1')
    await h.text['workspace'](reader([JSON.stringify({ v: 1, id: 'a1', type: 'panel.clear_highlight', highlight_id: 'h' })]), { identity: 'agent' })
    await h.text['workspace'](reader(['{not json']), { identity: 'agent' })
    await h.text['workspace'](reader([JSON.stringify({ v: 9, id: 'a2', type: 'panel.clear_highlight', highlight_id: 'h' })]), { identity: 'agent' })
    expect(got).toEqual(['panel.clear_highlight'])
  })

  it('turns transcription streams into segments for each speaker', async () => {
    const s = new LiveKitLiveSession()
    const segs: TranscriptSegment[] = []
    s.onTranscript((x) => segs.push(x))
    await s.connect('s1')
    await h.text['lk.transcription'](reader(['Hel', 'Hello'], { 'lk.segment_id': 'seg-a' }), { identity: 'agent' })
    await h.text['lk.transcription'](reader(['I think'], { 'lk.segment_id': 'seg-b', 'lk.transcribed_track_id': 'TR_cand', 'lk.transcription_final': 'false' }), { identity: 'agent' })
    expect(segs.at(-2)).toMatchObject({ id: 'seg-a', speaker: 'interviewer', text: 'Hello', final: true })
    expect(segs.at(-1)).toMatchObject({ id: 'seg-b', speaker: 'candidate', text: 'I think', final: false })
  })

  it('reports the agent state from its participant attribute', async () => {
    const s = new LiveKitLiveSession()
    const states: string[] = []
    s.onAgentState((a) => states.push(a))
    await s.connect('s1')
    h.on['participantAttributesChanged']({}, { isAgent: true, attributes: { 'lk.agent.state': 'thinking' } })
    h.on['participantDisconnected']({ isAgent: true, attributes: {} })
    expect(states).toEqual(['thinking', 'absent'])
  })

  it('sends stamped messages on the workspace topic and bytes in chunks', async () => {
    const s = new LiveKitLiveSession()
    await s.connect('s1')
    s.send({ type: 'workspace.hello', has_content: false })
    const [text, opts] = sendText.mock.calls[0] as unknown as [string, { topic: string }]
    expect(opts.topic).toBe('workspace')
    expect(JSON.parse(text)).toMatchObject({ v: 1, type: 'workspace.hello' })
    await s.sendBytes('board.snapshot', new Uint8Array(20_000), { request_id: 'r1' })
    expect(streamBytes).toHaveBeenCalledWith(expect.objectContaining({ topic: 'workspace.board.snapshot', attributes: { request_id: 'r1' } }))
    expect(h.writer.write).toHaveBeenCalledTimes(2)
    expect(h.writer.close).toHaveBeenCalled()
  })
})
```

- [ ] **Step 4: Write the failing `useProctor` test**

Replace `apps/web/features/interview-live/proctor/useProctor.test.tsx` with:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { MockLiveSession } from '../session/MockLiveSession'
import { MERGE_WINDOW_MS } from './ledger'
import { requestEntireScreen, stopScreenShare } from './screenShare'
import { WARNING_TEXT, useProctor } from './useProctor'

let hidden = false
function setFullscreen(on: boolean) {
  ;(document as unknown as { fullscreenElement: Element | null }).fullscreenElement = on ? document.documentElement : null
  document.dispatchEvent(new Event('fullscreenchange'))
}

beforeEach(() => {
  hidden = false
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  ;(document as unknown as { fullscreenElement: Element | null }).fullscreenElement = document.documentElement
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  stopScreenShare()
  Reflect.deleteProperty(navigator.mediaDevices, 'getDisplayMedia')
})

describe('useProctor', () => {
  it('counts a tab switch once and reports one merged event', () => {
    const session = new MockLiveSession()
    const { result } = renderHook(() => useProctor({ session, enabled: true }))
    act(() => {
      window.dispatchEvent(new Event('blur'))
      hidden = true
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current.ledger).toMatchObject({ tabChanges: 1, screenChanges: 0, fullViolations: 1 })
    expect(result.current.toast).toBe(WARNING_TEXT)
    expect(session.sentOf('proctor.event')).toHaveLength(0)
    act(() => { vi.advanceTimersByTime(MERGE_WINDOW_MS) })
    expect(session.sentOf('proctor.event')).toEqual([
      expect.objectContaining({ kind: 'tab_hidden', weight: 1, counts: { tab_changes: 1, screen_changes: 0, full_violations: 1 } }),
    ])
  })

  it('weights leaving full screen at one half and shows the return bar', () => {
    const session = new MockLiveSession()
    const { result } = renderHook(() => useProctor({ session, enabled: true }))
    act(() => setFullscreen(false))
    expect(result.current.ledger.screenChanges).toBe(0.5)
    expect(result.current.outOfFullscreen).toBe(true)
    act(() => { vi.advanceTimersByTime(MERGE_WINDOW_MS) })
    expect(session.sentOf('proctor.event')[0]).toMatchObject({ kind: 'fullscreen_exit', weight: 0.5 })
  })

  it('counts a round that starts out of full screen', () => {
    ;(document as unknown as { fullscreenElement: Element | null }).fullscreenElement = null
    const { result } = renderHook(() => useProctor({ session: new MockLiveSession(), enabled: true }))
    expect(result.current.ledger.entries[0]?.kind).toBe('fullscreen_exit')
  })

  it('counts a stopped share at one half', async () => {
    let end = () => {}
    const track = { kind: 'video', stop: vi.fn(), getSettings: () => ({ displaySurface: 'monitor' }), addEventListener: (_t: string, cb: () => void) => { end = cb } }
    Object.assign(navigator.mediaDevices, { getDisplayMedia: vi.fn(async () => ({ getTracks: () => [track], getVideoTracks: () => [track] })) })
    await requestEntireScreen()
    const { result } = renderHook(() => useProctor({ session: new MockLiveSession(), enabled: true }))
    act(() => end())
    expect(result.current.shareStopped).toBe(true)
    expect(result.current.ledger.entries[0]).toMatchObject({ kind: 'share_stopped', weight: 0.5 })
  })

  it('ignores the window blur caused by the share picker', async () => {
    Object.assign(navigator.mediaDevices, { getDisplayMedia: vi.fn(() => new Promise(() => {})) })
    const { result } = renderHook(() => useProctor({ session: new MockLiveSession(), enabled: true }))
    void requestEntireScreen()
    act(() => { window.dispatchEvent(new Event('blur')) })
    expect(result.current.ledger.entries).toEqual([])
  })
})
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `cd apps/web && pnpm vitest run features/interview-live/session features/interview-live/proctor/useProctor.test.tsx`
Expected: FAIL — `END_FALLBACK_MS`, `emitTranscript`, `sentOf`, `WARNING_TEXT` and the new machine events don't exist yet.

- [ ] **Step 6: Rewrite `session/types.ts`**

```ts
/**
 * The LiveSession seam: the boundary between the room UI and the live connection (LiveKit + the
 * interviewer agent). Implementations: MockLiveSession (a controllable fake, extended by
 * ScriptedLiveSession for local development) and LiveKitLiveSession.
 */
import type { AgentMessage, WebMessageBody } from '../protocol/messages'
import type { TranscriptSegment } from './transcript'

export type ConnState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

/** From LiveKit Agents' `lk.agent.state` attribute; `absent` while no interviewer is in the room. */
export type AgentState = 'absent' | 'initializing' | 'listening' | 'thinking' | 'speaking'

/** Binary payloads the browser sends: a PNG of the whiteboard, or its compressed scene backup. */
export type BytesKind = 'board.snapshot' | 'board.backup'

export interface LiveSession {
  connect(sessionId: string): Promise<void>
  disconnect(): Promise<void>
  readonly connectionState: ConnState

  getLocalStream(): MediaStream | null
  setMicEnabled(on: boolean): void
  setCameraEnabled(on: boolean): void

  /** Sends one web → agent workspace message; stamps `v` and `id` and returns the id. */
  send(body: WebMessageBody): string
  sendBytes(kind: BytesKind, data: Uint8Array, attributes?: Record<string, string>): Promise<void>

  onMessage(cb: (m: AgentMessage) => void): () => void
  /** The whiteboard scene the agent sends after `workspace.restore` with `board: true`. */
  onBoardRestore(cb: (data: Uint8Array, attributes: Record<string, string>) => void): () => void
  onTranscript(cb: (s: TranscriptSegment) => void): () => void
  onAgentState(cb: (s: AgentState) => void): () => void
  onConnectionChange(cb: (s: ConnState) => void): () => void
}
```

- [ ] **Step 7: Rewrite `session/machine.ts`**

```ts
import type { EndReason } from '../protocol/messages'

export type LiveState = 'prejoin' | 'checks' | 'connecting' | 'live' | 'reconnecting' | 'ending' | 'ended' | 'error'
export type LiveEvent =
  | { type: 'START_CHECKS' } | { type: 'CHECKS_PASSED' } | { type: 'CHECKS_FAILED' }
  | { type: 'CONNECTED' } | { type: 'RECONNECTING' } | { type: 'RECONNECTED' }
  | { type: 'END' } | { type: 'ENDED'; reason: EndReason; message?: string } | { type: 'ERROR' }
export interface LiveContext { endedReason: EndReason | null; endedMessage: string | null }

export function initialMachine(): { state: LiveState; ctx: LiveContext } {
  return { state: 'prejoin', ctx: { endedReason: null, endedMessage: null } }
}

/** The round never pauses (spec §7): proctoring counts and warns while the interview keeps running. */
export function transition(state: LiveState, ctx: LiveContext, event: LiveEvent): { state: LiveState; ctx: LiveContext } {
  if (state === 'ended') return { state, ctx }
  if (event.type === 'ERROR') return { state: 'error', ctx }
  const end = (e: Extract<LiveEvent, { type: 'ENDED' }>) => ({
    state: 'ended' as const,
    ctx: { endedReason: e.reason, endedMessage: e.message ?? null },
  })
  switch (state) {
    case 'prejoin':
      if (event.type === 'START_CHECKS') return { state: 'checks', ctx }
      break
    case 'checks':
      if (event.type === 'CHECKS_PASSED') return { state: 'connecting', ctx }
      if (event.type === 'CHECKS_FAILED') return { state: 'prejoin', ctx }
      break
    case 'connecting':
      if (event.type === 'CONNECTED') return { state: 'live', ctx }
      break
    case 'live':
      if (event.type === 'RECONNECTING') return { state: 'reconnecting', ctx }
      if (event.type === 'END') return { state: 'ending', ctx }
      if (event.type === 'ENDED') return end(event)
      break
    case 'reconnecting':
      if (event.type === 'RECONNECTED') return { state: 'live', ctx }
      if (event.type === 'END') return { state: 'ending', ctx }
      if (event.type === 'ENDED') return end(event)
      break
    case 'ending':
      if (event.type === 'ENDED') return end(event)
      break
  }
  return { state, ctx }
}
```

- [ ] **Step 8: Rewrite `session/LiveSessionProvider.tsx`**

```tsx
'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { stopScreenShare } from '../proctor/screenShare'
import { LiveKitLiveSession } from './LiveKitLiveSession'
import { initialMachine, transition, type LiveContext, type LiveEvent, type LiveState } from './machine'
import { applySegment, systemNote, type TranscriptSegment } from './transcript'
import type { AgentState, LiveSession } from './types'

/** How long End waits for the interviewer's goodbye before ending the room locally. */
export const END_FALLBACK_MS = 5000

interface Ctx {
  session: LiveSession
  state: LiveState
  ctx: LiveContext
  send: (e: LiveEvent) => void
  transcript: TranscriptSegment[]
  agentState: AgentState
  /** Adds a centred notice to the transcript. */
  addNote: (text: string) => void
  /** The candidate confirmed End: ask the interviewer to close the round, with a local fallback. */
  requestEnd: () => void
}
const LiveCtx = createContext<Ctx | null>(null)

export function LiveSessionProvider({ session, children }: { sessionId: string; session?: LiveSession; children: React.ReactNode }) {
  // Lazy useState (not useRef) so the stable session instance can be read during render.
  const [liveSession] = useState<LiveSession>(() => session ?? new LiveKitLiveSession())
  const [{ state, ctx }, dispatch] = useReducer(
    (s: { state: LiveState; ctx: LiveContext }, e: LiveEvent) => transition(s.state, s.ctx, e),
    undefined, initialMachine,
  )
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([])
  const [agentState, setAgentState] = useState<AgentState>('absent')
  const stateRef = useRef(state)
  const endTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { stateRef.current = state }, [state])

  const send = useCallback((e: LiveEvent) => dispatch(e), [])
  const addNote = useCallback((text: string) => setTranscript((t) => applySegment(t, systemNote(text))), [])

  useEffect(() => liveSession.onMessage((m) => {
    if (m.type === 'session.ending') dispatch({ type: 'ENDED', reason: m.reason, message: m.message })
  }), [liveSession])
  useEffect(() => liveSession.onTranscript((s) => setTranscript((t) => applySegment(t, s))), [liveSession])
  useEffect(() => liveSession.onAgentState(setAgentState), [liveSession])
  useEffect(() => liveSession.onConnectionChange((s) => {
    if (s === 'reconnecting') dispatch({ type: 'RECONNECTING' })
    else if (s === 'connected') dispatch({ type: 'RECONNECTED' })
    // The interviewer deletes the room after its goodbye: after End that is the candidate's ending.
    else if (s === 'disconnected') dispatch({ type: 'ENDED', reason: stateRef.current === 'ending' ? 'candidate_ended' : 'technical' })
  }), [liveSession])

  const requestEnd = useCallback(() => {
    dispatch({ type: 'END' })
    liveSession.send({ type: 'session.end_request' })
    if (endTimer.current) clearTimeout(endTimer.current)
    endTimer.current = setTimeout(() => {
      endTimer.current = null
      dispatch({ type: 'ENDED', reason: 'candidate_ended' })
    }, END_FALLBACK_MS)
  }, [liveSession])

  // Release media on any exit (navigation away, unmount).
  useEffect(() => () => {
    if (endTimer.current) clearTimeout(endTimer.current)
    void liveSession.disconnect()
    stopScreenShare()
  }, [liveSession])

  // Every path into `ended` (interviewer, End, a drop) releases media and leaves full screen.
  useEffect(() => {
    if (state !== 'ended') return
    if (endTimer.current) clearTimeout(endTimer.current)
    void liveSession.disconnect()
    stopScreenShare()
    if (typeof document !== 'undefined' && document.fullscreenElement) void document.exitFullscreen()
  }, [state, liveSession])

  const value = useMemo<Ctx>(
    () => ({ session: liveSession, state, ctx, send, transcript, agentState, addNote, requestEnd }),
    [liveSession, state, ctx, send, transcript, agentState, addNote, requestEnd],
  )
  return <LiveCtx.Provider value={value}>{children}</LiveCtx.Provider>
}

export function useLiveSession(): Ctx {
  const v = useContext(LiveCtx)
  if (!v) throw new Error('useLiveSession must be used within a LiveSessionProvider')
  return v
}
```

- [ ] **Step 9: Rewrite `session/MockLiveSession.ts`**

```ts
import { stampWeb, type AgentMessage, type WebMessage, type WebMessageBody } from '../protocol/messages'
import type { TranscriptSegment } from './transcript'
import type { AgentState, BytesKind, ConnState, LiveSession } from './types'

type Cb<T> = (v: T) => void

function channel<T>() {
  const set = new Set<Cb<T>>()
  return {
    add(cb: Cb<T>) {
      set.add(cb)
      return () => { set.delete(cb) }
    },
    emit(v: T) { set.forEach((cb) => cb(v)) },
  }
}

/** A controllable fake LiveSession for tests and local development. It records what the room sends
 * (`sent`, `bytes`) and lets the caller play the agent's side (`emitMessage`, `emitTranscript`, …).
 * ScriptedLiveSession builds the scripted interviewer on top of it. */
export class MockLiveSession implements LiveSession {
  connectionState: ConnState = 'idle'
  readonly sent: WebMessage[] = []
  readonly bytes: { kind: BytesKind; data: Uint8Array; attributes: Record<string, string> }[] = []
  micEnabled = true
  private stream: MediaStream | null = null
  /** Bumped on connect/disconnect so a superseded connect() doesn't resurrect the session. */
  private token = 0
  private readonly messages = channel<AgentMessage>()
  private readonly restores = channel<{ data: Uint8Array; attributes: Record<string, string> }>()
  private readonly transcripts = channel<TranscriptSegment>()
  private readonly agentStates = channel<AgentState>()
  private readonly conns = channel<ConnState>()

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async connect(_sessionId: string): Promise<void> {
    const t = ++this.token
    this.setConn('connecting')
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
    } catch {
      stream = null
    }
    if (t !== this.token) {
      stream?.getTracks().forEach((tr) => tr.stop())
      return
    }
    this.stream = stream
    this.setConn('connected')
    this.emitAgentState('listening')
  }

  async disconnect(): Promise<void> {
    this.token++
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    if (this.connectionState !== 'disconnected') this.setConn('disconnected')
  }

  getLocalStream() { return this.stream }

  setMicEnabled(on: boolean) {
    this.micEnabled = on
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = on))
  }

  setCameraEnabled(on: boolean) { this.stream?.getVideoTracks().forEach((t) => (t.enabled = on)) }

  send(body: WebMessageBody): string {
    const m = stampWeb(body)
    this.sent.push(m)
    this.handleSent(m)
    return m.id
  }

  async sendBytes(kind: BytesKind, data: Uint8Array, attributes: Record<string, string> = {}): Promise<void> {
    this.bytes.push({ kind, data, attributes })
    this.handleBytes(kind, data, attributes)
  }

  onMessage(cb: Cb<AgentMessage>) { return this.messages.add(cb) }
  onBoardRestore(cb: (data: Uint8Array, attributes: Record<string, string>) => void) {
    return this.restores.add(({ data, attributes }) => cb(data, attributes))
  }
  onTranscript(cb: Cb<TranscriptSegment>) { return this.transcripts.add(cb) }
  onAgentState(cb: Cb<AgentState>) { return this.agentStates.add(cb) }
  onConnectionChange(cb: Cb<ConnState>) { return this.conns.add(cb) }

  // ---------------------------------------------------------------- the agent's side

  emitMessage(m: AgentMessage) { this.messages.emit(m) }
  emitBoardRestore(data: Uint8Array, attributes: Record<string, string> = {}) { this.restores.emit({ data, attributes }) }
  emitTranscript(s: TranscriptSegment) { this.transcripts.emit(s) }
  emitAgentState(s: AgentState) { this.agentStates.emit(s) }
  simulateConnection(s: ConnState) { this.setConn(s) }

  /** The messages of one type the room sent, for assertions. */
  sentOf<T extends WebMessage['type']>(type: T): Extract<WebMessage, { type: T }>[] {
    return this.sent.filter((m): m is Extract<WebMessage, { type: T }> => m.type === type)
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected handleSent(_m: WebMessage): void {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected handleBytes(_kind: BytesKind, _data: Uint8Array, _attributes: Record<string, string>): void {}

  protected setConn(s: ConnState) {
    this.connectionState = s
    this.conns.emit(s)
  }
}
```

- [ ] **Step 10: Rewrite `session/LiveKitLiveSession.ts`**

```ts
import { ConnectionState, Room, RoomEvent, Track } from 'livekit-client'
import type { Participant, RemoteTrack } from 'livekit-client'
import { goLive } from '@/features/interview/api'
import { BYTE_TOPICS, WORKSPACE_TOPIC, parseAgentMessage, stampWeb, type AgentMessage, type WebMessageBody } from '../protocol/messages'
import type { TranscriptSegment } from './transcript'
import type { AgentState, BytesKind, ConnState, LiveSession } from './types'

type Cb<T> = (v: T) => void
// The readers' types, taken from the handler signatures so they track the installed SDK.
type TextStreamReader = Parameters<Parameters<Room['registerTextStreamHandler']>[1]>[0]
type ByteStreamReader = Parameters<Parameters<Room['registerByteStreamHandler']>[1]>[0]

const TRANSCRIPTION_TOPIC = 'lk.transcription'
const AGENT_STATE_ATTRIBUTE = 'lk.agent.state'
/** LiveKit's recommended byte-stream chunk size. */
const CHUNK = 15_000
const BYTES_TOPIC: Record<BytesKind, string> = {
  'board.snapshot': BYTE_TOPICS.boardSnapshot,
  'board.backup': BYTE_TOPICS.boardBackup,
}
const AGENT_STATES = new Set<AgentState>(['initializing', 'listening', 'thinking', 'speaking'])

function mapConnState(s: ConnectionState): ConnState {
  switch (s) {
    case ConnectionState.Connecting:
      return 'connecting'
    case ConnectionState.Connected:
      return 'connected'
    case ConnectionState.Reconnecting:
    case ConnectionState.SignalReconnecting:
      return 'reconnecting'
    default:
      return 'disconnected'
  }
}

function agentStateOf(p: Pick<Participant, 'attributes'>): AgentState {
  const v = p.attributes?.[AGENT_STATE_ATTRIBUTE] as AgentState | undefined
  return v && AGENT_STATES.has(v) ? v : 'initializing'
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0))
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.byteLength
  }
  return out
}

/** The real LiveSession: a LiveKit room. Workspace messages travel on the `workspace` text-stream
 * topic, images and scenes on byte streams; transcripts and the interviewer's state come from
 * LiveKit Agents (`lk.transcription`, `lk.agent.state`). */
export class LiveKitLiveSession implements LiveSession {
  connectionState: ConnState = 'idle'
  private room: Room | null = null
  private stream: MediaStream | null = null
  private audioTracks: RemoteTrack[] = []
  private audioEls: HTMLMediaElement[] = []
  private readonly messageCbs = new Set<Cb<AgentMessage>>()
  private readonly restoreCbs = new Set<(data: Uint8Array, attributes: Record<string, string>) => void>()
  private readonly transcriptCbs = new Set<Cb<TranscriptSegment>>()
  private readonly agentCbs = new Set<Cb<AgentState>>()
  private readonly connCbs = new Set<Cb<ConnState>>()

  async connect(sessionId: string): Promise<void> {
    this.setConn('connecting')
    try {
      const { livekitUrl, token } = await goLive(sessionId)
      if (!livekitUrl || !token) throw new Error('goLive did not return a livekitUrl/token')

      const room = new Room()
      // Handlers return their promise so a caller (and the tests) can await the whole read.
      room.registerTextStreamHandler(WORKSPACE_TOPIC, (reader) => this.readWorkspace(reader))
      room.registerTextStreamHandler(TRANSCRIPTION_TOPIC, (reader, participant) => this.readTranscription(reader, participant.identity))
      room.registerByteStreamHandler(BYTE_TOPICS.boardRestore, (reader) => this.readRestore(reader))
      room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => this.setConn(mapConnState(state)))
      room.on(RoomEvent.ParticipantConnected, (p: Participant) => { if (p.isAgent) this.emitAgent(agentStateOf(p)) })
      room.on(RoomEvent.ParticipantDisconnected, (p: Participant) => { if (p.isAgent) this.emitAgent('absent') })
      room.on(RoomEvent.ParticipantAttributesChanged, (_changed: Record<string, string>, p: Participant) => {
        if (p.isAgent) this.emitAgent(agentStateOf(p))
      })
      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio) {
          this.audioTracks.push(track)
          this.audioEls.push(track.attach())
        }
      })
      this.room = room

      await room.connect(livekitUrl, token)
      for (const p of room.remoteParticipants.values()) if (p.isAgent) this.emitAgent(agentStateOf(p))

      // Best-effort: a denied mic or blocked autoplay must not fail connect().
      try { await room.localParticipant.setMicrophoneEnabled(true) } catch { /* mic denied */ }
      try { await room.startAudio() } catch { /* autoplay blocked until a gesture */ }
    } catch (err) {
      this.setConn('disconnected')
      throw err
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
    } catch {
      this.stream = null // self-view is best-effort only
    }

    // Only force 'connected' if nothing truer arrived while getUserMedia was pending.
    if (this.connectionState === 'connecting') this.setConn('connected')
  }

  async disconnect(): Promise<void> {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.audioTracks.forEach((track) => track.detach())
    this.audioEls.forEach((el) => el.remove())
    this.audioTracks = []
    this.audioEls = []
    await this.room?.disconnect()
    this.setConn('disconnected')
  }

  getLocalStream() { return this.stream }

  setMicEnabled(on: boolean) {
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = on))
    void this.room?.localParticipant.setMicrophoneEnabled(on)?.catch(() => {})
  }

  setCameraEnabled(on: boolean) { this.stream?.getVideoTracks().forEach((t) => (t.enabled = on)) }

  send(body: WebMessageBody): string {
    const m = stampWeb(body)
    const sending = this.room?.localParticipant.sendText(JSON.stringify(m), { topic: WORKSPACE_TOPIC })
    void sending?.catch(() => {})
    return m.id
  }

  async sendBytes(kind: BytesKind, data: Uint8Array, attributes: Record<string, string> = {}): Promise<void> {
    const local = this.room?.localParticipant
    if (!local) return
    const writer = await local.streamBytes({
      name: `${kind}-${Date.now()}`,
      topic: BYTES_TOPIC[kind],
      attributes,
      totalSize: data.byteLength,
      mimeType: kind === 'board.snapshot' ? 'image/png' : 'application/octet-stream',
    })
    for (let i = 0; i < data.byteLength; i += CHUNK) await writer.write(data.subarray(i, i + CHUNK))
    await writer.close()
  }

  onMessage(cb: Cb<AgentMessage>) { this.messageCbs.add(cb); return () => { this.messageCbs.delete(cb) } }
  onBoardRestore(cb: (data: Uint8Array, attributes: Record<string, string>) => void) {
    this.restoreCbs.add(cb)
    return () => { this.restoreCbs.delete(cb) }
  }
  onTranscript(cb: Cb<TranscriptSegment>) { this.transcriptCbs.add(cb); return () => { this.transcriptCbs.delete(cb) } }
  onAgentState(cb: Cb<AgentState>) { this.agentCbs.add(cb); return () => { this.agentCbs.delete(cb) } }
  onConnectionChange(cb: Cb<ConnState>) { this.connCbs.add(cb); return () => { this.connCbs.delete(cb) } }

  private async readWorkspace(reader: TextStreamReader) {
    let text: string
    try {
      text = await reader.readAll()
    } catch {
      return // the sender aborted or we reconnected mid-stream
    }
    const m = parseAgentMessage(text)
    if (m) this.messageCbs.forEach((cb) => cb(m))
  }

  private async readTranscription(reader: TextStreamReader, identity: string) {
    const attrs = reader.info.attributes ?? {}
    const id = attrs['lk.segment_id'] ?? reader.info.id
    const speaker = this.isCandidate(identity, attrs['lk.transcribed_track_id']) ? 'candidate' : 'interviewer'
    const at = Date.now()
    let text = ''
    try {
      for await (const chunk of reader) {
        // Chunks may be cumulative or deltas depending on the SDK version; handle both.
        text = chunk.startsWith(text) ? chunk : text + chunk
        this.transcriptCbs.forEach((cb) => cb({ id, speaker, text, final: false, at }))
      }
    } catch {
      return
    }
    const final = attrs['lk.transcription_final'] === 'true' || speaker === 'interviewer'
    this.transcriptCbs.forEach((cb) => cb({ id, speaker, text, final, at }))
  }

  private isCandidate(identity: string, trackSid?: string): boolean {
    const local = this.room?.localParticipant
    if (!local) return false
    if (identity === local.identity) return true
    return !!trackSid && Array.from(local.trackPublications.values()).some((p) => p.trackSid === trackSid)
  }

  private async readRestore(reader: ByteStreamReader) {
    let chunks: Uint8Array[]
    try {
      chunks = await reader.readAll()
    } catch {
      return
    }
    const data = concat(chunks)
    const attributes = reader.info.attributes ?? {}
    this.restoreCbs.forEach((cb) => cb(data, attributes))
  }

  private emitAgent(s: AgentState) { this.agentCbs.forEach((cb) => cb(s)) }

  private setConn(s: ConnState) {
    this.connectionState = s
    this.connCbs.forEach((cb) => cb(s))
  }
}
```

- [ ] **Step 11: Rewrite `proctor/useProctor.ts`**

```ts
'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProctorKind } from '../protocol/messages'
import type { LiveSession } from '../session/types'
import { EMPTY_LEDGER, MERGE_WINDOW_MS, recordEvent, type Ledger } from './ledger'
import { isPrompting, useScreenShared } from './screenShare'
import { useExternalDisplay } from './useExternalDisplay'
import { useFullscreen } from './useFullscreen'
import { useVisibility } from './useVisibility'

export const TOAST_MS = 4000
export const WARNING_TEXT = "Don't change screens while the interview is running."

export interface ProctorState {
  ledger: Ledger
  outOfFullscreen: boolean
  shareStopped: boolean
  toast: string | null
}

interface Signals {
  fullscreen: boolean
  hidden: boolean
  blurred: boolean
  extended: boolean
  shared: boolean
}

/** Watches tab visibility, window focus, full screen, a second display and the screen share (spec
 * §7). One action's signals merge into one weighted ledger entry: the warning toast shows at once,
 * and the merged event goes to the interviewer when the merge window closes. Never pauses the round. */
export function useProctor({ session, enabled }: { session: LiveSession; enabled: boolean }): ProctorState {
  const { isFullscreen } = useFullscreen()
  const { hidden } = useVisibility()
  const { extended } = useExternalDisplay()
  const shared = useScreenShared()
  const [blurred, setBlurred] = useState(false)
  const [ledger, setLedger] = useState<Ledger>(EMPTY_LEDGER)
  const [toast, setToast] = useState<string | null>(null)
  const ledgerRef = useRef(ledger)
  const prev = useRef<Signals | null>(null)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())

  useEffect(() => {
    const onBlur = () => { if (!isPrompting()) setBlurred(true) }
    const onFocus = () => setBlurred(false)
    window.addEventListener('blur', onBlur)
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  useEffect(() => {
    const pending = timers.current
    return () => { pending.forEach(clearTimeout); pending.clear() }
  }, [])

  const later = useCallback((ms: number, fn: () => void) => {
    const t = setTimeout(() => { timers.current.delete(t); fn() }, ms)
    timers.current.add(t)
  }, [])

  const record = useCallback((kind: ProctorKind) => {
    const { ledger: next, change } = recordEvent(ledgerRef.current, kind, Date.now())
    if (change.kind === 'merged') return
    ledgerRef.current = next
    setLedger(next)
    if (change.kind !== 'added') return
    setToast(WARNING_TEXT)
    later(TOAST_MS, () => setToast(null))
    const index = next.entries.length - 1
    later(MERGE_WINDOW_MS, () => {
      const l = ledgerRef.current
      const entry = l.entries[index]
      if (!entry) return
      session.send({
        type: 'proctor.event', kind: entry.kind, weight: entry.weight, at: entry.at,
        counts: { tab_changes: l.tabChanges, screen_changes: l.screenChanges, full_violations: l.fullViolations },
      })
    })
  }, [later, session])

  useEffect(() => {
    if (!enabled) {
      prev.current = null
      return
    }
    const now: Signals = { fullscreen: isFullscreen, hidden, blurred, extended: extended === true, shared }
    const was = prev.current
    prev.current = now
    // On the first run an already-bad state counts, so entering out of full screen isn't a bypass.
    if ((was === null || was.fullscreen) && !now.fullscreen) record('fullscreen_exit')
    if ((was === null || !was.hidden) && now.hidden) record('tab_hidden')
    if ((was === null || !was.blurred) && now.blurred && !now.hidden) record('window_blur')
    if ((was === null || !was.extended) && now.extended) record('external_display')
    if (was !== null && was.shared && !now.shared) record('share_stopped')
  }, [enabled, isFullscreen, hidden, blurred, extended, shared, record])

  return {
    ledger,
    outOfFullscreen: enabled && !isFullscreen,
    shareStopped: enabled && !shared,
    toast,
  }
}
```

- [ ] **Step 12: Update the components that used the old seam**

`apps/web/features/interview-live/work/CodeEditor.tsx` — add a version counter and send `code.snapshot`. Replace:

```ts
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
```

with:

```ts
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const version = useRef(0)
```

and replace:

```ts
    timer.current = setTimeout(() => session.sendArtifact({ kind: 'code', content: value, language: lang }), 800)
```

with:

```ts
    timer.current = setTimeout(() => {
      version.current += 1
      session.send({ type: 'code.snapshot', version: version.current, language: lang, text: value })
    }, 800)
```

`apps/web/features/interview-live/work/DiagramBoard.tsx` — replace:

```ts
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
```

with:

```ts
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const version = useRef(0)
```

and replace:

```ts
          timer.current = setTimeout(() => session.sendArtifact({ kind: 'diagram', content: summarizeScene(elements) }), 800)
```

with:

```ts
          timer.current = setTimeout(() => {
            version.current += 1
            session.send({ type: 'board.summary', version: version.current, text: summarizeScene(elements) })
          }, 800)
```

`apps/web/features/interview-live/work/TranscriptPanel.tsx` — replace:

```ts
import type { TranscriptEntry } from '../session/types'

interface TranscriptPanelProps {
  entries: TranscriptEntry[]
  interviewerName: string
}

function speakerLabel(speaker: TranscriptEntry['speaker'], interviewerName: string): string {
```

with:

```ts
import type { TranscriptSegment } from '../session/transcript'

interface TranscriptPanelProps {
  entries: Pick<TranscriptSegment, 'speaker' | 'text'>[]
  interviewerName: string
}

function speakerLabel(speaker: TranscriptSegment['speaker'], interviewerName: string): string {
```

`apps/web/app/(app)/interviews/[sessionId]/live/_components/LiveInterview.tsx`:
- Delete the line `import { ViolationOverlay } from "@/features/interview-live/proctor/ViolationOverlay";`.
- In `LiveInterviewInner`, replace `const { state, session } = useLiveSession();` with `const { state } = useLiveSession();`.
- Replace the whole `case "live": case "paused": …` block, including the comment above it, with:

```tsx
    case "live":
      return (
        <RoomFrame variant="live">
          <LiveView sessionId={sessionId} meta={meta} />
        </RoomFrame>
      );
```

`apps/web/app/(app)/interviews/[sessionId]/live/_components/LiveView.tsx` (temporary until Task 12):
- Replace `const { session, state, send, speaking, transcript, ctx } = useLiveSession()` with:

```ts
  const { session, transcript, agentState, requestEnd } = useLiveSession()
  const speaking = { interviewer: agentState === 'speaking' }
```

- Replace `useProctor({ session, enabled: true, onViolation: () => {} })` with `const proctor = useProctor({ session, enabled: true })`.
- Replace the whole `function handleEnd() { … }` (with its comment) with:

```ts
  function handleEnd() {
    requestEnd()
  }
```

- Replace `const violations = ctx.violations` with `const violations = proctor.ledger.tabChanges + proctor.ledger.screenChanges`.
- Replace `state={state === 'paused' ? 'idle' : 'live'}` with `state="live"`.
- Replace `{violations === 1 ? '1 pause logged' : `${violations} pauses logged`}` with `{`${violations} switch${violations === 1 ? '' : 'es'} logged`}`.

`apps/web/app/(app)/interviews/[sessionId]/live/_components/EndedView.tsx`: replace `ctx.endedReason === 'aborted_technical'` with `ctx.endedReason === 'technical'`.

`apps/web/features/interview-live/work/CodeEditor.test.tsx`: replace the `send` spy and assertion. Replace:

```ts
    const send = vi.spyOn(session, "sendArtifact");
```

with nothing (delete the line), and replace:

```ts
    await waitFor(() => expect(send).toHaveBeenLastCalledWith({ kind: "code", content: "# write your solution here\n", language: "typescript" }), { timeout: 2000 });
```

with:

```ts
    await waitFor(() => expect(session.sentOf("code.snapshot").at(-1)).toMatchObject({ text: "# write your solution here\n", language: "typescript" }), { timeout: 2000 });
```

- [ ] **Step 13: Delete the files tied to the old seam, the pause flow and the old layout**

Delete: `features/interview-live/proctor/ViolationOverlay.tsx`, `features/interview-live/proctor/ViolationOverlay.test.tsx`, `features/interview-live/session/types.test.ts`, `features/interview-live/session/machine.reconnecting.test.ts`, `features/interview-live/session/LiveSessionProvider.reconnect.test.tsx`, `app/(app)/interviews/[sessionId]/live/_components/LiveInterview.remount.test.tsx`, `app/(app)/interviews/[sessionId]/live/_components/LiveView.test.tsx`, `app/(app)/interviews/[sessionId]/live/_components/LiveView.end.test.tsx`.

- [ ] **Step 14: Run the tests to verify they pass**

Run: `cd apps/web && pnpm vitest run features/interview-live "app/(app)/interviews/[sessionId]/live"`
Expected: PASS. Then run `cd apps/web && pnpm typecheck`; expected: no errors in `features/interview-live` or the live route.

---

### Task 6: Workspace provider (routing, acks, restore, Ask)

**Files:**
- Create: `apps/web/features/interview-live/workspace/WorkspaceProvider.tsx`
- Create: `apps/web/features/interview-live/workspace/WorkspaceProvider.test.tsx`
- Modify: `apps/web/app/(app)/interviews/[sessionId]/live/_components/LiveView.tsx` (wrap in the provider until Task 12)

**Interfaces:**
- Consumes: Task 1 (`AgentMessage`, `AgentMessageOf`, `CodeLanguage`, `newMessageId`), Task 2 (`panelReducer`, `EMPTY_PANEL`, `hasCard`, `cardFromWire`, `findQuote`, `PanelState`, `PanelAction`), Task 5 (`LiveSession`).
- Produces:
  - `type AckResult = { ok: true } | { ok: false; reason: string }`
  - `type CodeInstruction = AgentMessageOf<'code.comment' | 'code.insert' | 'code.highlight' | 'code.clear_highlight'>`
  - `interface CodeApi { apply(m: CodeInstruction): AckResult; restore(code: { language: CodeLanguage; text: string }): void; hasContent(): boolean }`
  - `interface BoardApi { draw(m: AgentMessageOf<'board.draw'>): AckResult; snapshotPng(): Promise<Uint8Array | null>; restore(data: Uint8Array, attributes: Record<string, string>): Promise<void>; hasContent(): boolean }`
  - `type Surface = 'code' | 'board'`, `type Expanded = 'none' | 'panel' | 'work'`
  - `interface AskSelection { surface: 'statement' | 'code' | 'board'; quote: string; itemId?: string; lines?: [number, number]; at: number }`
  - `WorkspaceProvider({ session, children })`, `useWorkspace(): { panel; selectCard(itemId); clearFlash(); addNote(itemId, body); addHighlight(itemId, quote, occurrence); ask; askAbout(sel: Omit<AskSelection, 'at'>); clearAsk(); registerCode(api | null); registerBoard(api | null); surface; setSurface(s); boardAttention; expanded; setExpanded(e); panelFull; setPanelFull(on) }`

- [ ] **Step 1: Write the failing test**

Create `apps/web/features/interview-live/workspace/WorkspaceProvider.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { stampAgent, type AgentMessageBody } from '../protocol/messages'
import { MockLiveSession } from '../session/MockLiveSession'
import { WorkspaceProvider, useWorkspace, type BoardApi, type CodeApi } from './WorkspaceProvider'

type Ws = ReturnType<typeof useWorkspace>
const STATEMENT = 'Return the longest substring with at most two distinct characters.'
const SHOW: AgentMessageBody = { type: 'panel.show_problem', item_id: 'slot-1', label: 'Problem 1', kind: 'problem', statement: STATEMENT, examples: [] }

function mount(session = new MockLiveSession()) {
  const ref: { current: Ws | null } = { current: null }
  function Probe() {
    ref.current = useWorkspace()
    return null
  }
  render(<WorkspaceProvider session={session}><Probe /></WorkspaceProvider>)
  const agent = async (body: AgentMessageBody) => {
    const m = stampAgent(body)
    await act(async () => { session.emitMessage(m) })
    return m.id
  }
  const ackFor = (id: string) => session.sentOf('ack').find((a) => a.ref === id)
  return { session, ref, agent, ackFor }
}

describe('WorkspaceProvider', () => {
  it('says hello when the room mounts', () => {
    const { session } = mount()
    expect(session.sentOf('workspace.hello')).toEqual([expect.objectContaining({ has_content: false })])
  })

  it('shows a problem, acknowledges it and pops the panel back from a filled editor', async () => {
    const { ref, agent, ackFor } = mount()
    act(() => ref.current!.setExpanded('work'))
    const id = await agent(SHOW)
    expect(ref.current!.panel.cards.map((c) => c.label)).toEqual(['Problem 1'])
    expect(ref.current!.expanded).toBe('none')
    expect(ackFor(id)).toMatchObject({ ok: true })
  })

  it('refuses sections for unknown problems and highlights whose text is missing', async () => {
    const { agent, ackFor } = mount()
    const sec = await agent({ type: 'panel.add_section', item_id: 'nope', section: { id: 's', kind: 'hint', title: 'Hint', body: 'x', author: 'interviewer' } })
    expect(ackFor(sec)).toMatchObject({ ok: false, reason: 'unknown_item' })
    await agent(SHOW)
    const bad = await agent({ type: 'panel.highlight', item_id: 'slot-1', highlight_id: 'h1', quote: 'three distinct' })
    expect(ackFor(bad)).toMatchObject({ ok: false, reason: 'quote_not_found' })
    const good = await agent({ type: 'panel.highlight', item_id: 'slot-1', highlight_id: 'h2', quote: 'two distinct' })
    expect(ackFor(good)).toMatchObject({ ok: true })
  })

  it('routes code instructions to the editor, or refuses them before it is ready', async () => {
    const { ref, agent, ackFor } = mount()
    const early = await agent({ type: 'code.comment', at: 'top', text: 'Why?', purpose: 'question' })
    expect(ackFor(early)).toMatchObject({ ok: false, reason: 'editor_not_ready' })
    const code: CodeApi = { apply: vi.fn(() => ({ ok: false as const, reason: 'line_changed' })), restore: vi.fn(), hasContent: () => false }
    act(() => ref.current!.registerCode(code))
    const late = await agent({ type: 'code.comment', at: 'top', text: 'Why?', purpose: 'question' })
    expect(code.apply).toHaveBeenCalled()
    expect(ackFor(late)).toMatchObject({ ok: false, reason: 'line_changed' })
  })

  it('flags the whiteboard tool when the interviewer draws while it is hidden', async () => {
    const { ref, agent } = mount()
    const board: BoardApi = { draw: vi.fn(() => ({ ok: true as const })), snapshotPng: async () => null, restore: vi.fn(async () => {}), hasContent: () => false }
    act(() => ref.current!.registerBoard(board))
    await agent({ type: 'board.draw', elements: [{ type: 'rectangle', id: 'n1' }] })
    expect(ref.current!.boardAttention).toBe(true)
    act(() => ref.current!.setSurface('board'))
    expect(ref.current!.boardAttention).toBe(false)
  })

  it('answers a snapshot request with the PNG bytes', async () => {
    const { session, ref, agent, ackFor } = mount()
    const png = new Uint8Array([137, 80])
    act(() => ref.current!.registerBoard({ draw: () => ({ ok: true }), snapshotPng: async () => png, restore: async () => {}, hasContent: () => true }))
    const id = await agent({ type: 'board.request_snapshot', request_id: 'snap-1' })
    await waitFor(() => expect(ackFor(id)).toMatchObject({ ok: true }))
    expect(session.bytes[0]).toMatchObject({ kind: 'board.snapshot', data: png, attributes: { request_id: 'snap-1' } })
  })

  it('restores problems, code and a whiteboard that arrives before the board is ready', async () => {
    const { session, ref, agent } = mount()
    const code: CodeApi = { apply: () => ({ ok: true }), restore: vi.fn(), hasContent: () => false }
    act(() => ref.current!.registerCode(code))
    await agent({
      type: 'workspace.restore', active_item_id: 'slot-1', board: true,
      cards: [{ item_id: 'slot-1', label: 'Problem 1', kind: 'problem', statement: STATEMENT, examples: [], sections: [], highlights: [] }],
      code: { language: 'java', text: 'class A {}' },
    })
    act(() => session.emitBoardRestore(new Uint8Array([1]), { encoding: 'none' }))
    expect(ref.current!.panel.activeId).toBe('slot-1')
    expect(code.restore).toHaveBeenCalledWith({ language: 'java', text: 'class A {}' })
    const board: BoardApi = { draw: () => ({ ok: true }), snapshotPng: async () => null, restore: vi.fn(async () => {}), hasContent: () => false }
    act(() => ref.current!.registerBoard(board))
    expect(board.restore).toHaveBeenCalledWith(new Uint8Array([1]), { encoding: 'none' })
  })

  it('sends the candidate notes, highlights and Ask selections; the next answer clears Ask', async () => {
    const { session, ref, agent } = mount()
    await agent(SHOW)
    act(() => {
      ref.current!.addNote('slot-1', 'Sliding window?')
      ref.current!.addHighlight('slot-1', 'two distinct', 0)
      ref.current!.askAbout({ surface: 'statement', quote: 'two distinct', itemId: 'slot-1' })
    })
    expect(session.sentOf('panel.section_added')[0].section).toMatchObject({ kind: 'note', body: 'Sliding window?', author: 'candidate' })
    expect(session.sentOf('panel.highlight_added')[0]).toMatchObject({ quote: 'two distinct', occurrence: 0 })
    expect(session.sentOf('ask.selection')[0]).toMatchObject({ surface: 'statement', quote: 'two distinct', item_id: 'slot-1' })
    act(() => session.emitTranscript({ id: 'i', speaker: 'interviewer', text: 'Sure', final: true, at: Date.now() + 1 }))
    expect(ref.current!.ask).not.toBeNull()
    act(() => session.emitTranscript({ id: 'c', speaker: 'candidate', text: 'What does this mean?', final: true, at: Date.now() + 2 }))
    expect(ref.current!.ask).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && pnpm vitest run features/interview-live/workspace/WorkspaceProvider.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `WorkspaceProvider.tsx`**

```tsx
'use client'
/**
 * The shared workspace (spec §6). Routes the interviewer's instructions to the panel state and to the
 * editor/whiteboard adapters they register, acknowledges each one, and sends the candidate's own
 * notes, highlights and Ask selections. Also holds the room's layout state (surface, expansion).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { newMessageId, type AgentMessage, type AgentMessageOf, type CodeLanguage } from '../protocol/messages'
import type { LiveSession } from '../session/types'
import { EMPTY_PANEL, cardFromWire, findQuote, hasCard, panelReducer, type PanelAction, type PanelState } from './panel'

export type AckResult = { ok: true } | { ok: false; reason: string }
export type CodeInstruction = AgentMessageOf<'code.comment' | 'code.insert' | 'code.highlight' | 'code.clear_highlight'>

export interface CodeApi {
  apply(m: CodeInstruction): AckResult
  restore(code: { language: CodeLanguage; text: string }): void
  hasContent(): boolean
}

export interface BoardApi {
  draw(m: AgentMessageOf<'board.draw'>): AckResult
  snapshotPng(): Promise<Uint8Array | null>
  restore(data: Uint8Array, attributes: Record<string, string>): Promise<void>
  hasContent(): boolean
}

export type Surface = 'code' | 'board'
/** Which half of the right side fills it: the problem panel, the work area, or neither. */
export type Expanded = 'none' | 'panel' | 'work'

export interface AskSelection {
  surface: 'statement' | 'code' | 'board'
  quote: string
  itemId?: string
  lines?: [number, number]
  at: number
}

interface WorkspaceCtx {
  panel: PanelState
  selectCard(itemId: string): void
  clearFlash(): void
  addNote(itemId: string, body: string): void
  addHighlight(itemId: string, quote: string, occurrence: number): void
  ask: AskSelection | null
  askAbout(sel: Omit<AskSelection, 'at'>): void
  clearAsk(): void
  registerCode(api: CodeApi | null): void
  registerBoard(api: BoardApi | null): void
  surface: Surface
  setSurface(s: Surface): void
  boardAttention: boolean
  expanded: Expanded
  setExpanded(e: Expanded): void
  panelFull: boolean
  setPanelFull(on: boolean): void
}

const Ctx = createContext<WorkspaceCtx | null>(null)

export function WorkspaceProvider({ session, children }: { session: LiveSession; children: React.ReactNode }) {
  const [panel, setPanel] = useState<PanelState>(EMPTY_PANEL)
  const panelRef = useRef(panel)
  const code = useRef<CodeApi | null>(null)
  const board = useRef<BoardApi | null>(null)
  const pendingBoard = useRef<{ data: Uint8Array; attributes: Record<string, string> } | null>(null)
  const [ask, setAskState] = useState<AskSelection | null>(null)
  const askRef = useRef(ask)
  const [surface, setSurfaceState] = useState<Surface>('code')
  const surfaceRef = useRef(surface)
  const [boardAttention, setBoardAttention] = useState(false)
  const [expanded, setExpanded] = useState<Expanded>('none')
  const [panelFull, setPanelFull] = useState(false)

  const applyPanel = useCallback((a: PanelAction) => {
    panelRef.current = panelReducer(panelRef.current, a)
    setPanel(panelRef.current)
  }, [])
  const setAsk = useCallback((a: AskSelection | null) => {
    askRef.current = a
    setAskState(a)
  }, [])
  const setSurface = useCallback((s: Surface) => {
    surfaceRef.current = s
    setSurfaceState(s)
    if (s === 'board') setBoardAttention(false)
  }, [])

  const handle = useCallback(async (m: AgentMessage): Promise<AckResult | null> => {
    switch (m.type) {
      case 'panel.show_problem':
        applyPanel({ type: 'show', card: { itemId: m.item_id, label: m.label, kind: m.kind, statement: m.statement, examples: m.examples } })
        setExpanded((e) => (e === 'work' ? 'none' : e))
        return { ok: true }
      case 'panel.add_section':
        if (!hasCard(panelRef.current, m.item_id)) return { ok: false, reason: 'unknown_item' }
        applyPanel({ type: 'add_section', itemId: m.item_id, section: m.section })
        return { ok: true }
      case 'panel.highlight': {
        const card = panelRef.current.cards.find((c) => c.itemId === m.item_id)
        if (!card) return { ok: false, reason: 'unknown_item' }
        const occurrence = m.occurrence ?? 0
        if (!findQuote(card.statement, m.quote, occurrence)) return { ok: false, reason: 'quote_not_found' }
        applyPanel({ type: 'highlight', itemId: m.item_id, highlight: { id: m.highlight_id, quote: m.quote, occurrence, note: m.note, author: 'interviewer' } })
        return { ok: true }
      }
      case 'panel.clear_highlight':
        applyPanel({ type: 'clear_highlight', highlightId: m.highlight_id })
        return { ok: true }
      case 'code.comment':
      case 'code.insert':
      case 'code.highlight':
      case 'code.clear_highlight':
        return code.current ? code.current.apply(m) : { ok: false, reason: 'editor_not_ready' }
      case 'board.draw': {
        if (!board.current) return { ok: false, reason: 'board_not_ready' }
        const result = board.current.draw(m)
        if (result.ok && surfaceRef.current !== 'board') setBoardAttention(true)
        return result
      }
      case 'board.request_snapshot': {
        if (!board.current) return { ok: false, reason: 'board_not_ready' }
        const png = await board.current.snapshotPng()
        if (!png) return { ok: false, reason: 'board_empty' }
        await session.sendBytes('board.snapshot', png, { request_id: m.request_id })
        return { ok: true }
      }
      case 'workspace.restore':
        applyPanel({ type: 'restore', cards: m.cards.map(cardFromWire), activeId: m.active_item_id })
        if (m.code) code.current?.restore(m.code)
        return { ok: true }
      case 'session.ending':
        return null // LiveSessionProvider ends the round
    }
  }, [applyPanel, session])

  useEffect(() => session.onMessage((m) => {
    void handle(m).then((r) => {
      if (r) session.send({ type: 'ack', ref: m.id, ok: r.ok, ...(r.ok ? {} : { reason: r.reason }) })
    })
  }), [session, handle])

  useEffect(() => session.onBoardRestore((data, attributes) => {
    if (board.current) void board.current.restore(data, attributes)
    else pendingBoard.current = { data, attributes }
  }), [session])

  // The candidate's next finished question carries the Ask selection; then it's done.
  useEffect(() => session.onTranscript((s) => {
    const a = askRef.current
    if (a && s.speaker === 'candidate' && s.final && s.at >= a.at) setAsk(null)
  }), [session, setAsk])

  // The interviewer sends no workspace instruction before this (spec §6.1).
  useEffect(() => {
    session.send({ type: 'workspace.hello', has_content: panelRef.current.cards.length > 0 })
  }, [session])

  // Every callback is stable: the editor and whiteboard register from mount effects and unregister in
  // their cleanup, so a callback that changed identity would unregister them on every render.
  const selectCard = useCallback((itemId: string) => applyPanel({ type: 'select', itemId }), [applyPanel])
  const clearFlash = useCallback(() => applyPanel({ type: 'flash_done' }), [applyPanel])
  const addNote = useCallback((itemId: string, body: string) => {
    const section = { id: newMessageId('sec'), kind: 'note' as const, title: 'Note', body, author: 'candidate' as const }
    applyPanel({ type: 'add_section', itemId, section })
    session.send({ type: 'panel.section_added', item_id: itemId, section })
  }, [applyPanel, session])
  const addHighlight = useCallback((itemId: string, quote: string, occurrence: number) => {
    const id = newMessageId('hl')
    applyPanel({ type: 'highlight', itemId, highlight: { id, quote, occurrence, author: 'candidate' } })
    session.send({ type: 'panel.highlight_added', item_id: itemId, highlight_id: id, quote, occurrence })
  }, [applyPanel, session])
  const askAbout = useCallback((sel: Omit<AskSelection, 'at'>) => {
    setAsk({ ...sel, at: Date.now() })
    session.send({
      type: 'ask.selection', surface: sel.surface, quote: sel.quote.slice(0, 4000),
      ...(sel.itemId ? { item_id: sel.itemId } : {}),
      ...(sel.lines ? { lines: sel.lines } : {}),
    })
  }, [session, setAsk])
  const clearAsk = useCallback(() => setAsk(null), [setAsk])
  const registerCode = useCallback((api: CodeApi | null) => { code.current = api }, [])
  const registerBoard = useCallback((api: BoardApi | null) => {
    board.current = api
    if (api && pendingBoard.current) {
      void api.restore(pendingBoard.current.data, pendingBoard.current.attributes)
      pendingBoard.current = null
    }
  }, [])

  const value = useMemo<WorkspaceCtx>(() => ({
    panel, selectCard, clearFlash, addNote, addHighlight, ask, askAbout, clearAsk, registerCode, registerBoard,
    surface, setSurface, boardAttention, expanded, setExpanded, panelFull, setPanelFull,
  }), [panel, selectCard, clearFlash, addNote, addHighlight, ask, askAbout, clearAsk, registerCode, registerBoard, surface, setSurface, boardAttention, expanded, panelFull])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useWorkspace(): WorkspaceCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useWorkspace must be used within a WorkspaceProvider')
  return v
}
```

- [ ] **Step 4: Wrap the temporary room in the provider**

From Task 8 on, the editor and whiteboard read the workspace context, so the temporary `LiveView` (replaced in Task 12) must provide it. In `apps/web/app/(app)/interviews/[sessionId]/live/_components/LiveView.tsx` add the import:

```ts
import { WorkspaceProvider } from '@/features/interview-live/workspace/WorkspaceProvider'
```

and wrap the outermost element the component returns:

```tsx
  return (
    <WorkspaceProvider session={session}>
      <div className="flex h-full min-h-0 w-full flex-col">
        {/* …the existing header, grid and BottomDrawer, unchanged… */}
      </div>
    </WorkspaceProvider>
  )
```

(keep everything inside the existing `<div className="flex h-full min-h-0 w-full flex-col">` exactly as it is; only the wrapper is new).

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/web && pnpm vitest run features/interview-live/workspace/WorkspaceProvider.test.tsx`
Expected: PASS (8 tests).

---

### Task 7: Problem panel

**Files:**
- Create: `apps/web/features/interview-live/panel/ProblemPanel.tsx`
- Create: `apps/web/features/interview-live/panel/Statement.tsx`
- Create: `apps/web/features/interview-live/panel/Sections.tsx`
- Create: `apps/web/features/interview-live/panel/SelectionToolbar.tsx`
- Create: `apps/web/features/interview-live/panel/ProblemPanel.test.tsx`

**Interfaces:**
- Consumes: `useWorkspace` (Task 6), `markSegments`, `occurrenceAt`, `ProblemCard` (Task 2), `SectionKind` (Task 1), `HudEmpty`, `StatusDot`.
- Produces: `ProblemPanel()` (no props; reads the workspace), `FLASH_MS = 1200`, `SelectionToolbar({ top, left, onHighlight?, onAsk, onDismiss })` (reused by nothing else yet).

- [ ] **Step 1: Write the failing test**

Create `apps/web/features/interview-live/panel/ProblemPanel.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { stampAgent, type AgentMessageBody } from '../protocol/messages'
import { MockLiveSession } from '../session/MockLiveSession'
import { WorkspaceProvider, useWorkspace } from '../workspace/WorkspaceProvider'
import { ProblemPanel } from './ProblemPanel'

const STATEMENT = 'Return the longest substring with at most two distinct characters.'
let ws: ReturnType<typeof useWorkspace> | null = null
function Probe() {
  ws = useWorkspace()
  return null
}
function mount() {
  const session = new MockLiveSession()
  render(<WorkspaceProvider session={session}><ProblemPanel /><Probe /></WorkspaceProvider>)
  const agent = (body: AgentMessageBody) => act(async () => { session.emitMessage(stampAgent(body)) })
  return { session, agent }
}
const SHOW: AgentMessageBody = {
  type: 'panel.show_problem', item_id: 'slot-1', label: 'Problem 1', kind: 'problem', statement: STATEMENT,
  examples: [{ input: 's = "eceba"', output: '3', explanation: 'The substring is "ece".' }, { input: 's = "ccaabbb"', output: '5' }],
}

/** Selects `text` inside `el` (whichever text node holds it, since highlights split the statement). */
function selectText(el: HTMLElement, text: string) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode() as Text | null
  while (node && !node.data.includes(text)) node = walker.nextNode() as Text | null
  if (!node) throw new Error(`"${text}" is not in the statement`)
  const start = node.data.indexOf(text)
  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(node, start + text.length)
  const sel = window.getSelection()!
  sel.removeAllRanges()
  sel.addRange(range)
  fireEvent.mouseUp(el)
}

describe('ProblemPanel', () => {
  it('waits for the interviewer, then shows the statement and both examples under a generic label', async () => {
    const { agent } = mount()
    expect(screen.getByText(/interviewer will put the problem here/i)).toBeInTheDocument()
    await agent(SHOW)
    expect(screen.getByRole('tab', { name: 'Problem 1', selected: true })).toBeInTheDocument()
    expect(screen.getByText(STATEMENT)).toBeInTheDocument()
    expect(screen.getByText('Example 1')).toBeInTheDocument()
    expect(screen.getByText('Example 2')).toBeInTheDocument()
    expect(screen.queryByText(/constraints/i)).not.toBeInTheDocument()
  })

  it('shows interviewer sections and highlights in the interviewer colour', async () => {
    const { agent } = mount()
    await agent(SHOW)
    await agent({ type: 'panel.add_section', item_id: 'slot-1', section: { id: 'c', kind: 'constraints', title: 'Constraints', body: '1 <= n <= 10^5', author: 'interviewer' } })
    await agent({ type: 'panel.highlight', item_id: 'slot-1', highlight_id: 'h', quote: 'two distinct' })
    expect(screen.getByRole('article', { name: 'Constraints' })).toHaveTextContent('1 <= n <= 10^5')
    const mark = document.querySelector('mark[data-author="interviewer"]')
    expect(mark).toHaveTextContent('two distinct')
  })

  it('lets the candidate highlight or ask about selected statement text', async () => {
    const { session, agent } = mount()
    await agent(SHOW)
    const text = screen.getByTestId('statement-text')
    selectText(text, 'longest substring')
    await userEvent.click(screen.getByRole('button', { name: 'Highlight' }))
    expect(document.querySelector('mark[data-author="candidate"]')).toHaveTextContent('longest substring')
    expect(session.sentOf('panel.highlight_added')[0]).toMatchObject({ quote: 'longest substring', occurrence: 0 })
    selectText(screen.getByTestId('statement-text'), 'at most')
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    expect(session.sentOf('ask.selection')[0]).toMatchObject({ surface: 'statement', quote: 'at most', item_id: 'slot-1' })
  })

  it('saves a candidate note', async () => {
    const { session, agent } = mount()
    await agent(SHOW)
    await userEvent.click(screen.getByRole('button', { name: 'Add a note' }))
    await userEvent.type(screen.getByLabelText('Note'), 'Use two pointers?')
    await userEvent.click(screen.getByRole('button', { name: 'Save note' }))
    expect(screen.getByRole('article', { name: 'Note' })).toHaveTextContent('Use two pointers?')
    expect(session.sentOf('panel.section_added')).toHaveLength(1)
  })

  it('expands, goes full screen, and shrinks to a label strip while the work area is expanded', async () => {
    const { agent } = mount()
    await agent(SHOW)
    await userEvent.click(screen.getByRole('button', { name: 'Expand problem panel' }))
    expect(ws!.expanded).toBe('panel')
    await userEvent.click(screen.getByRole('button', { name: 'Problem full screen' }))
    expect(screen.getByTestId('panel-full')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Exit problem full screen' }))
    act(() => ws!.setExpanded('work'))
    expect(screen.queryByText(STATEMENT)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Problem 1' }))
    expect(ws!.expanded).toBe('none')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && pnpm vitest run features/interview-live/panel/ProblemPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `SelectionToolbar.tsx`**

```tsx
'use client'
import { useEffect, useRef } from 'react'

/** The small floating toolbar over a selection: Highlight · Ask. It keeps the selection alive while
 * clicked (mousedown is prevented) and dismisses on a click elsewhere. */
export function SelectionToolbar({
  top,
  left,
  onHighlight,
  onAsk,
  onDismiss,
}: {
  top: number
  left: number
  onHighlight?: () => void
  onAsk: () => void
  onDismiss: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onDismiss])

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Selection"
      style={{ top, left }}
      onMouseDown={(e) => e.preventDefault()}
      className="absolute z-10 flex -translate-x-1/2 -translate-y-[calc(100%+6px)] items-center gap-1 rounded-full border border-line-3 bg-card p-1 shadow-hero"
    >
      {onHighlight ? (
        <button type="button" onClick={onHighlight} className="h-7 rounded-full px-3 text-[12.5px] text-foreground transition-colors hover:bg-panel">
          Highlight
        </button>
      ) : null}
      <button type="button" onClick={onAsk} className="h-7 rounded-full bg-foreground px-3 text-[12.5px] text-background">
        Ask
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Write `Statement.tsx`**

```tsx
'use client'
import { useCallback, useRef, useState } from 'react'
import { cn } from '@/lib/utils/cn'
import { markSegments, occurrenceAt, type ProblemCard } from '../workspace/panel'
import { useWorkspace } from '../workspace/WorkspaceProvider'
import { SelectionToolbar } from './SelectionToolbar'

interface Picked {
  quote: string
  occurrence: number
  top: number
  left: number
}

/** The statement with its highlights (interviewer in orange, the candidate's neutral) and the two
 * examples. Selecting statement text offers Highlight · Ask. Constraints are never shown here unless
 * the interviewer adds them as a section. */
export function Statement({ card }: { card: ProblemCard }) {
  const { addHighlight, askAbout } = useWorkspace()
  const box = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLParagraphElement>(null)
  const [picked, setPicked] = useState<Picked | null>(null)
  const dismiss = useCallback(() => setPicked(null), [])

  function onMouseUp() {
    const sel = window.getSelection()
    const text = textRef.current
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !text || !box.current) return setPicked(null)
    const range = sel.getRangeAt(0)
    if (!text.contains(range.commonAncestorContainer)) return setPicked(null)
    const raw = sel.toString()
    const quote = raw.trim()
    if (!quote) return setPicked(null)
    const pre = document.createRange()
    pre.selectNodeContents(text)
    pre.setEnd(range.startContainer, range.startOffset)
    const start = pre.toString().length + (raw.length - raw.trimStart().length)
    const r = typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null
    const b = box.current.getBoundingClientRect()
    setPicked({
      quote,
      occurrence: occurrenceAt(card.statement, quote, start),
      top: r ? r.top - b.top : 0,
      left: r ? r.left - b.left + r.width / 2 : 0,
    })
  }

  function finish(action: () => void) {
    action()
    window.getSelection()?.removeAllRanges()
    setPicked(null)
  }

  return (
    <div ref={box} className="relative">
      <p
        ref={textRef}
        data-testid="statement-text"
        onMouseUp={onMouseUp}
        className="m-0 whitespace-pre-wrap text-[14px] leading-[1.6] text-foreground"
      >
        {markSegments(card.statement, card.highlights).map((piece, i) =>
          piece.highlight ? (
            <mark
              key={i}
              data-author={piece.highlight.author}
              title={piece.highlight.note}
              className={cn(
                'rounded-[3px] px-0.5 text-foreground',
                piece.highlight.author === 'interviewer' ? 'bg-brand/15 ring-1 ring-brand/40' : 'bg-panel ring-1 ring-line-4',
              )}
            >
              {piece.text}
            </mark>
          ) : (
            <span key={i}>{piece.text}</span>
          ),
        )}
      </p>
      {card.examples.map((ex, i) => (
        <div key={i} className="mt-4">
          <p className="iq-eyebrow m-0 mb-1.5">Example {i + 1}</p>
          <div className="rounded-[11px] border border-line-2 bg-panel/60 px-3 py-2.5 font-mono text-[12.5px] leading-[1.6]">
            <p className="m-0 whitespace-pre-wrap"><span className="text-faint">Input: </span>{ex.input}</p>
            <p className="m-0 whitespace-pre-wrap"><span className="text-faint">Output: </span>{ex.output}</p>
            {ex.explanation ? (
              <p className="m-0 mt-1 whitespace-pre-wrap font-sans text-[13px] text-muted-foreground">{ex.explanation}</p>
            ) : null}
          </div>
        </div>
      ))}
      {picked ? (
        <SelectionToolbar
          top={picked.top}
          left={picked.left}
          onHighlight={() => finish(() => addHighlight(card.itemId, picked.quote, picked.occurrence))}
          onAsk={() => finish(() => askAbout({ surface: 'statement', quote: picked.quote, itemId: card.itemId }))}
          onDismiss={dismiss}
        />
      ) : null}
    </div>
  )
}
```

- [ ] **Step 5: Write `Sections.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { StatusDot } from '@/components/hud'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils/cn'
import type { SectionKind } from '../protocol/messages'
import type { ProblemCard } from '../workspace/panel'
import { useWorkspace } from '../workspace/WorkspaceProvider'

const KIND_LABEL: Record<SectionKind, string> = {
  constraints: 'Constraints',
  format: 'Input and output',
  clarification: 'Clarification',
  hint: 'Hint',
  explanation: 'Explanation',
  note: 'Note',
}

/** Sections either side added to a problem, with their author; the candidate can add notes. */
export function Sections({ card }: { card: ProblemCard }) {
  const { addNote } = useWorkspace()
  const [draft, setDraft] = useState<string | null>(null)
  const noteId = `note-${card.itemId}`

  return (
    <div className="mt-5 flex flex-col gap-2.5">
      {card.sections.map((s) => (
        <article
          key={s.id}
          aria-label={KIND_LABEL[s.kind]}
          className={cn('rounded-[11px] border px-3 py-2.5', s.author === 'interviewer' ? 'border-brand/30' : 'border-line-2')}
        >
          <div className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.08em]">
            <span className="text-foreground">{KIND_LABEL[s.kind]}</span>
            <span aria-hidden className="h-px flex-1 bg-line-2" />
            <StatusDot
              state={s.author === 'interviewer' ? 'active' : 'idle'}
              label={s.author === 'interviewer' ? 'Interviewer' : 'You'}
              className="text-muted-foreground"
            />
          </div>
          {s.title !== KIND_LABEL[s.kind] ? <p className="m-0 mt-1.5 text-[13px] font-medium">{s.title}</p> : null}
          <p className="m-0 mt-1 whitespace-pre-wrap text-[13.5px] leading-[1.55] text-foreground">{s.body}</p>
        </article>
      ))}
      {draft === null ? (
        <button
          type="button"
          onClick={() => setDraft('')}
          className="self-start rounded-full border border-line-3 px-3 py-1 text-[12.5px] text-muted-foreground transition-colors hover:text-foreground"
        >
          Add a note
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const body = draft.trim()
            if (body) addNote(card.itemId, body)
            setDraft(null)
          }}
          className="flex flex-col gap-2"
        >
          <label htmlFor={noteId} className="sr-only">Note</label>
          <Textarea id={noteId} value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} maxLength={4000} className="text-[13.5px]" autoFocus />
          <div className="flex gap-2">
            <Button type="submit" className="h-8 px-3 text-[12.5px]">Save note</Button>
            <Button type="button" variant="ghost" className="h-8 px-3 text-[12.5px]" onClick={() => setDraft(null)}>Cancel</Button>
          </div>
        </form>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Write `ProblemPanel.tsx`**

```tsx
'use client'
import { useEffect } from 'react'
import { Expand, Maximize2, Minimize2, Shrink } from 'lucide-react'
import { HudEmpty } from '@/components/hud'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils/cn'
import { useWorkspace } from '../workspace/WorkspaceProvider'
import { Sections } from './Sections'
import { Statement } from './Statement'

export const FLASH_MS = 1200

const iconButton = 'h-7 w-7 text-muted-foreground hover:text-foreground'

/** The problem panel (spec §6.3, §10): one tab per problem the interviewer showed, labelled
 * generically. Expands to fill the right side, has its own full screen, and shrinks to a label strip
 * while the work area is expanded. Stays at one tree position in every mode so nothing remounts. */
export function ProblemPanel() {
  const { panel, selectCard, clearFlash, expanded, setExpanded, panelFull, setPanelFull } = useWorkspace()
  const active = panel.cards.find((c) => c.itemId === panel.activeId) ?? null
  const strip = expanded === 'work' && !panelFull

  useEffect(() => {
    if (!panel.flashId) return
    const t = setTimeout(clearFlash, FLASH_MS)
    return () => clearTimeout(t)
  }, [panel.flashId, clearFlash])

  return (
    <section
      aria-label="Problem"
      data-testid={panelFull ? 'panel-full' : undefined}
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-[14px] border border-line-2 bg-card',
        panelFull ? 'fixed inset-2 z-[60] shadow-hero' : 'h-full',
      )}
    >
      <header className="flex h-[38px] flex-none items-center gap-2 border-b border-line-2 px-3">
        <h2 className="m-0 font-mono text-[11px] font-normal uppercase tracking-[0.08em] text-muted-foreground">Problem</h2>
        <span aria-hidden className="h-px w-4 bg-line-3" />
        <div role="tablist" aria-label="Problems" className="flex min-w-0 gap-1 overflow-x-auto">
          {panel.cards.map((c) => (
            <button
              key={c.itemId}
              role="tab"
              type="button"
              aria-selected={c.itemId === panel.activeId}
              onClick={() => {
                selectCard(c.itemId)
                if (strip) setExpanded('none')
              }}
              className={cn(
                'h-[24px] flex-none rounded-full px-2.5 text-[12px] transition-colors',
                c.itemId === panel.activeId ? 'bg-panel text-foreground' : 'text-faint hover:text-foreground',
                panel.flashId === c.itemId && 'ring-2 ring-brand/50 motion-safe:animate-pulse',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          {!panelFull ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={expanded === 'panel' ? 'Restore problem panel' : 'Expand problem panel'}
              aria-pressed={expanded === 'panel'}
              onClick={() => setExpanded(expanded === 'panel' ? 'none' : 'panel')}
              className={iconButton}
            >
              {expanded === 'panel' ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={panelFull ? 'Exit problem full screen' : 'Problem full screen'}
            aria-pressed={panelFull}
            onClick={() => setPanelFull(!panelFull)}
            className={iconButton}
          >
            {panelFull ? <Shrink className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </header>
      {strip ? null : (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {active ? (
            <>
              <Statement card={active} />
              <Sections card={active} />
            </>
          ) : (
            <HudEmpty
              tag="Waiting"
              title="The interviewer will put the problem here."
              hint="Questions you discuss out loud don't appear here."
            />
          )}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd apps/web && pnpm vitest run features/interview-live/panel/ProblemPanel.test.tsx`
Expected: PASS (5 tests).

---

### Task 8: Code editor adapter (interviewer comments, inserts, highlights; candidate highlight and Ask)

**Files:**
- Create: `apps/web/features/interview-live/work/codeApi.ts`
- Create: `apps/web/features/interview-live/work/codeApi.test.ts`
- Modify (rewrite): `apps/web/features/interview-live/work/CodeEditor.tsx`
- Modify: `apps/web/features/interview-live/work/CodeEditor.test.tsx`
- Modify: `apps/web/app/globals.css` (append decoration classes)

**Interfaces:**
- Consumes: `resolveLine`, `insertionText`, `overlaps`, `starterText`, `LANGUAGES`, `Language` (Task 3); `CodeApi`, `CodeInstruction`, `AckResult`, `useWorkspace` (Task 6).
- Produces: `RangeLike`, `DecorationLike`, `ModelLike`, `EditorLike`, `EditorCodeApi extends CodeApi { onEdited(ranges); markCandidate(start, end); isApplying() }`, `createCodeApi(editor, getLanguage, setLanguage)`, class names `AGENT_LINE_CLASS`, `AGENT_GLYPH_CLASS`, `AGENT_HIGHLIGHT_CLASS`, `CANDIDATE_HIGHLIGHT_CLASS`; `CodeEditor({ session })` (must render inside `WorkspaceProvider`).

- [ ] **Step 1: Write the failing adapter test**

Create `apps/web/features/interview-live/work/codeApi.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { CodeLanguage } from '../protocol/messages'
import { stampAgent } from '../protocol/messages'
import type { CodeInstruction } from '../workspace/WorkspaceProvider'
import { AGENT_GLYPH_CLASS, AGENT_HIGHLIGHT_CLASS, createCodeApi, type DecorationLike, type EditorLike, type RangeLike } from './codeApi'

class FakeEditor implements EditorLike {
  lines: string[]
  decorations = new Map<string, DecorationLike>()
  undoStops = 0
  private n = 0
  constructor(text: string) { this.lines = text.split('\n') }
  getModel() {
    return {
      getLinesContent: () => this.lines.slice(),
      getValue: () => this.lines.join('\n'),
      setValue: (v: string) => { this.lines = v.split('\n') },
      getDecorationRange: (id: string) => this.decorations.get(id)?.range ?? null,
    }
  }
  executeEdits(_source: string, edits: { range: RangeLike; text: string }[]) {
    for (const e of edits) this.lines.splice(e.range.startLineNumber - 1, 0, ...e.text.replace(/\n$/, '').split('\n'))
    return true
  }
  pushUndoStop() { this.undoStops += 1; return true }
  deltaDecorations(old: string[], next: DecorationLike[]) {
    old.forEach((id) => this.decorations.delete(id))
    return next.map((d) => { const id = `d${++this.n}`; this.decorations.set(id, d); return id })
  }
}

const CODE = 'def f(s):\n    seen = {}\n    for c in s:\n        seen[c] = 1\n    return len(seen)'
const msg = (body: Parameters<typeof stampAgent>[0]) => stampAgent(body) as CodeInstruction
function setup(text = CODE, language: CodeLanguage = 'python') {
  const editor = new FakeEditor(text)
  let lang = language
  const api = createCodeApi(editor, () => lang, (l) => { lang = l })
  return { editor, api, lang: () => lang }
}

describe('createCodeApi', () => {
  it('adds an interviewer comment at the top as its own undo step, marked in the gutter', () => {
    const { editor, api } = setup()
    expect(api.apply(msg({ type: 'code.comment', at: 'top', text: 'Complexity?', purpose: 'question' }))).toEqual({ ok: true })
    expect(editor.lines[0]).toBe('# Complexity?')
    expect(editor.undoStops).toBe(2)
    expect([...editor.decorations.values()][0].options.glyphMarginClassName).toBe(AGENT_GLYPH_CLASS)
  })

  it('uses the language comment syntax above the expected line', () => {
    const { editor, api } = setup('class A {\n  int x;\n}', 'java')
    api.apply(msg({ type: 'code.comment', at: { line: 2, expect: 'int x;' }, text: 'Why int?', purpose: 'question' }))
    expect(editor.lines).toEqual(['class A {', '// Why int?', '  int x;', '}'])
  })

  it('follows a line the candidate pushed down, and refuses one they changed', () => {
    const { editor, api } = setup()
    editor.lines.unshift('# my notes', '# more')
    expect(api.apply(msg({ type: 'code.comment', at: { line: 3, expect: 'for c in s:' }, text: 'Empty s?', purpose: 'question' }))).toEqual({ ok: true })
    expect(editor.lines[4]).toBe('# Empty s?')
    expect(editor.lines[5]).toBe('    for c in s:')
    expect(api.apply(msg({ type: 'code.comment', at: { line: 3, expect: 'while True:' }, text: 'x', purpose: 'question' }))).toEqual({ ok: false, reason: 'line_changed' })
  })

  it('inserts short code verbatim and refuses long inserts', () => {
    const { editor, api } = setup()
    api.apply(msg({ type: 'code.insert', at: 'top', text: 'print(f("ab"))', purpose: 'test_input' }))
    expect(editor.lines[0]).toBe('print(f("ab"))')
    const long = Array.from({ length: 11 }, (_, i) => `x${i} = ${i}`).join('\n')
    expect(api.apply(msg({ type: 'code.insert', at: 'top', text: long, purpose: 'stub' }))).toEqual({ ok: false, reason: 'too_long' })
  })

  it('highlights lines, clears them on request, and drops them when the candidate edits those lines', () => {
    const { editor, api } = setup()
    api.apply(msg({ type: 'code.highlight', highlight_id: 'h1', start_line: 3, end_line: 4, expect: 'for c in s:', note: 'Walk me through this.' }))
    expect([...editor.decorations.values()][0].options.className).toBe(AGENT_HIGHLIGHT_CLASS)
    api.onEdited([{ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }])
    expect(editor.decorations.size).toBe(1)
    api.onEdited([{ startLineNumber: 4, startColumn: 1, endLineNumber: 4, endColumn: 3 }])
    expect(editor.decorations.size).toBe(0)
    api.apply(msg({ type: 'code.highlight', highlight_id: 'h2', start_line: 1, end_line: 1, expect: 'def f(s):' }))
    api.apply(msg({ type: 'code.clear_highlight', highlight_id: 'h2' }))
    expect(editor.decorations.size).toBe(0)
  })

  it('restores code and language, and treats the starter text as empty', () => {
    const { editor, api, lang } = setup('# write your solution here\n')
    expect(api.hasContent()).toBe(false)
    api.restore({ language: 'go', text: 'package main' })
    expect(lang()).toBe('go')
    expect(editor.lines).toEqual(['package main'])
    expect(api.hasContent()).toBe(true)
  })

  it('reports applying only while its own edit runs', () => {
    const { editor, api } = setup()
    const seen: boolean[] = []
    const original = editor.executeEdits.bind(editor)
    editor.executeEdits = vi.fn((s, e) => { seen.push(api.isApplying()); return original(s, e) })
    api.apply(msg({ type: 'code.comment', at: 'top', text: 'x', purpose: 'hint' }))
    expect(seen).toEqual([true])
    expect(api.isApplying()).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && pnpm vitest run features/interview-live/work/codeApi.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `codeApi.ts`**

```ts
/**
 * Applies the interviewer's code instructions to Monaco (spec §6.4). Typed against the small slice of
 * the editor API it uses, so tests drive it with a fake editor.
 */
import type { AgentMessageOf, CodeLanguage, LineAnchor } from '../protocol/messages'
import { insertionText, overlaps, resolveLine, starterText, type Language } from '../workspace/codeOps'
import type { AckResult, CodeApi, CodeInstruction } from '../workspace/WorkspaceProvider'

export interface RangeLike {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

export interface DecorationLike {
  range: RangeLike
  options: { isWholeLine?: boolean; className?: string; glyphMarginClassName?: string; hoverMessage?: { value: string } }
}

export interface ModelLike {
  getLinesContent(): string[]
  getValue(): string
  setValue(value: string): void
  getDecorationRange(id: string): RangeLike | null
}

export interface EditorLike {
  getModel(): ModelLike | null
  executeEdits(source: string, edits: { range: RangeLike; text: string; forceMoveMarkers?: boolean }[]): boolean
  pushUndoStop(): boolean
  deltaDecorations(oldIds: string[], next: DecorationLike[]): string[]
}

export const AGENT_LINE_CLASS = 'iq-agent-line'
export const AGENT_GLYPH_CLASS = 'iq-agent-glyph'
export const AGENT_HIGHLIGHT_CLASS = 'iq-agent-highlight'
export const CANDIDATE_HIGHLIGHT_CLASS = 'iq-cand-highlight'

const atLine = (n: number): RangeLike => ({ startLineNumber: n, startColumn: 1, endLineNumber: n, endColumn: 1 })
const lines = (a: number, b: number): RangeLike => ({ startLineNumber: a, startColumn: 1, endLineNumber: b, endColumn: 1 })

export interface EditorCodeApi extends CodeApi {
  /** Drops interviewer highlights on lines the candidate just edited. */
  onEdited(ranges: RangeLike[]): void
  /** Marks lines the candidate highlighted. */
  markCandidate(start: number, end: number): void
  /** True while this adapter's own edit runs, so the editor ignores its change event. */
  isApplying(): boolean
}

export function createCodeApi(
  editor: EditorLike,
  getLanguage: () => Language,
  setLanguage: (language: CodeLanguage) => void,
): EditorCodeApi {
  const highlights = new Map<string, string[]>()
  let candidate: string[] = []
  let applying = false

  function insert(at: LineAnchor, text: string): AckResult {
    const model = editor.getModel()
    if (!model) return { ok: false, reason: 'editor_not_ready' }
    const target = resolveLine(model.getLinesContent(), at)
    if (target === null) return { ok: false, reason: 'line_changed' }
    const count = text.split('\n').length - 1
    editor.pushUndoStop()
    applying = true
    try {
      editor.executeEdits('interviewer', [{ range: atLine(target), text, forceMoveMarkers: true }])
    } finally {
      applying = false
    }
    editor.pushUndoStop()
    editor.deltaDecorations([], [{
      range: lines(target, target + count - 1),
      options: { isWholeLine: true, className: AGENT_LINE_CLASS, glyphMarginClassName: AGENT_GLYPH_CLASS, hoverMessage: { value: 'Added by the interviewer' } },
    }])
    return { ok: true }
  }

  function highlight(m: AgentMessageOf<'code.highlight'>): AckResult {
    const model = editor.getModel()
    if (!model) return { ok: false, reason: 'editor_not_ready' }
    const content = model.getLinesContent()
    const start = resolveLine(content, { line: m.start_line, expect: m.expect })
    if (start === null) return { ok: false, reason: 'line_changed' }
    const end = Math.min(start + Math.max(0, m.end_line - m.start_line), content.length)
    const ids = editor.deltaDecorations(highlights.get(m.highlight_id) ?? [], [{
      range: lines(start, end),
      options: { isWholeLine: true, className: AGENT_HIGHLIGHT_CLASS, ...(m.note ? { hoverMessage: { value: m.note } } : {}) },
    }])
    highlights.set(m.highlight_id, ids)
    return { ok: true }
  }

  return {
    apply(m: CodeInstruction): AckResult {
      switch (m.type) {
        case 'code.comment':
          return insert(m.at, insertionText(getLanguage(), 'comment', m.text) as string)
        case 'code.insert': {
          const text = insertionText(getLanguage(), 'code', m.text)
          return text === null ? { ok: false, reason: 'too_long' } : insert(m.at, text)
        }
        case 'code.highlight':
          return highlight(m)
        case 'code.clear_highlight': {
          const ids = highlights.get(m.highlight_id)
          if (ids) editor.deltaDecorations(ids, [])
          highlights.delete(m.highlight_id)
          return { ok: true }
        }
      }
    },
    restore(code) {
      setLanguage(code.language)
      editor.getModel()?.setValue(code.text)
    },
    hasContent() {
      const value = editor.getModel()?.getValue() ?? ''
      return value.trim() !== '' && value !== starterText(getLanguage())
    },
    onEdited(ranges) {
      const model = editor.getModel()
      if (!model) return
      for (const [id, ids] of highlights) {
        const r = ids.map((d) => model.getDecorationRange(d)).find((x): x is RangeLike => x !== null)
        if (!r) continue
        if (ranges.some((c) => overlaps(c.startLineNumber, c.endLineNumber, r.startLineNumber, r.endLineNumber))) {
          editor.deltaDecorations(ids, [])
          highlights.delete(id)
        }
      }
    },
    markCandidate(start, end) {
      candidate = editor.deltaDecorations(candidate, [{ range: lines(start, end), options: { isWholeLine: true, className: CANDIDATE_HIGHLIGHT_CLASS } }])
    },
    isApplying: () => applying,
  }
}
```

- [ ] **Step 4: Rewrite `CodeEditor.tsx`**

```tsx
'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import type { OnMount } from '@monaco-editor/react'
import { CustomSelect } from '@/components/ui/custom-select'
import type { LiveSession } from '../session/types'
import { LANGUAGES, starterText, type Language } from '../workspace/codeOps'
import { useWorkspace } from '../workspace/WorkspaceProvider'
import { createCodeApi, type EditorCodeApi } from './codeApi'

const Editor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => <div data-motion className="h-full animate-pulse bg-panel" />,
})

export const SNAPSHOT_DEBOUNCE_MS = 800

const toolButton = 'h-7 rounded-full border border-line-3 px-2.5 text-[12px] text-foreground transition-colors hover:border-faint-2'

/** The shared Monaco editor. Sends a `code.snapshot` 800ms after typing stops; registers the code
 * adapter that applies the interviewer's comments, inserts and highlights; lets the candidate
 * highlight lines or ask about a selection. */
export function CodeEditor({ session }: { session: LiveSession }) {
  const { registerCode, askAbout } = useWorkspace()
  const [lang, setLang] = useState<Language>('python')
  const [value, setValue] = useState(() => starterText('python'))
  const [selection, setSelection] = useState<{ start: number; end: number; text: string } | null>(null)
  const langRef = useRef(lang)
  const api = useRef<EditorCodeApi | null>(null)
  const version = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Presentation only: Monaco follows the app's light/dark theme.
  const { resolvedTheme } = useTheme()

  useEffect(() => { langRef.current = lang }, [lang])
  useEffect(() => () => registerCode(null), [registerCode])

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      version.current += 1
      session.send({ type: 'code.snapshot', version: version.current, language: lang, text: value })
    }, SNAPSHOT_DEBOUNCE_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [value, lang, session])

  const onMount: OnMount = (editor) => {
    const codeApi = createCodeApi(editor, () => langRef.current, (l) => setLang(l))
    api.current = codeApi
    editor.onDidChangeModelContent((e) => {
      if (!codeApi.isApplying()) codeApi.onEdited(e.changes.map((c) => c.range))
    })
    editor.onDidChangeCursorSelection(() => {
      const sel = editor.getSelection()
      const model = editor.getModel()
      if (!sel || !model || sel.isEmpty()) return setSelection(null)
      setSelection({ start: sel.startLineNumber, end: sel.endLineNumber, text: model.getValueInRange(sel) })
    })
    registerCode(codeApi)
  }

  function changeLanguage(next: Language) {
    if (value === starterText(lang)) setValue(starterText(next))
    setLang(next)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
        <label htmlFor="code-language" className="sr-only">
          Language
        </label>
        <CustomSelect
          id="code-language"
          label="Language"
          value={lang}
          onValueChange={(v) => { const next = LANGUAGES.find((item) => item === v); if (next) changeLanguage(next) }}
          options={LANGUAGES.map((language) => ({ value: language, label: language }))}
          className="h-7 w-auto rounded-full border border-line-3 bg-card px-2.5 font-mono text-[12px] text-foreground transition-colors hover:border-faint-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
        {selection ? (
          <div role="toolbar" aria-label="Code selection" className="ml-auto flex items-center gap-1">
            <button
              type="button"
              className={toolButton}
              onClick={() => {
                api.current?.markCandidate(selection.start, selection.end)
                session.send({ type: 'code.highlight_added', start_line: selection.start, end_line: selection.end, text: selection.text.slice(0, 4000) })
              }}
            >
              Highlight lines
            </button>
            <button
              type="button"
              className="h-7 rounded-full bg-foreground px-3 text-[12px] text-background"
              onClick={() => askAbout({ surface: 'code', quote: selection.text.slice(0, 4000) || `lines ${selection.start}-${selection.end}`, lines: [selection.start, selection.end] })}
            >
              Ask
            </button>
          </div>
        ) : null}
      </div>
      <div className="flex-1">
        <Editor
          height="100%"
          language={lang}
          theme={resolvedTheme === 'dark' ? 'vs-dark' : 'light'}
          value={value}
          onChange={(v) => setValue(v ?? '')}
          onMount={onMount}
          options={{ minimap: { enabled: false }, fontSize: 14, automaticLayout: true, scrollBeyondLastLine: false, padding: { top: 12 }, glyphMargin: true }}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Add the decoration styles**

Append to `apps/web/app/globals.css`:

```css
/* Live interview editor: interviewer marks are the brand orange (the room's only accent). */
.iq-agent-line { background: hsl(var(--brand) / 0.06); }
.iq-agent-glyph { background: hsl(var(--brand)); width: 3px !important; margin-left: 6px; border-radius: 2px; }
.iq-agent-highlight { background: hsl(var(--brand) / 0.16); }
.iq-cand-highlight { background: hsl(var(--foreground) / 0.08); }
```

- [ ] **Step 6: Update the CodeEditor test for the workspace context**

In `apps/web/features/interview-live/work/CodeEditor.test.tsx`, add the import:

```ts
import { WorkspaceProvider } from "../workspace/WorkspaceProvider";
```

and replace `render(<CodeEditor session={session} />);` with:

```tsx
    render(<WorkspaceProvider session={session}><CodeEditor session={session} /></WorkspaceProvider>);
```

The language-switch assertion becomes (the starter comment follows the language):

```ts
    await waitFor(() => expect(session.sentOf("code.snapshot").at(-1)).toMatchObject({ text: "// write your solution here\n", language: "typescript" }), { timeout: 2000 });
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd apps/web && pnpm vitest run features/interview-live/work/codeApi.test.ts features/interview-live/work/CodeEditor.test.tsx`
Expected: PASS.

---

### Task 9: Whiteboard adapter (draw, snapshot, backup, restore, Ask)

**Files:**
- Create: `apps/web/features/interview-live/work/boardApi.ts`
- Create: `apps/web/features/interview-live/work/boardApi.test.ts`
- Modify (rewrite): `apps/web/features/interview-live/work/DiagramBoard.tsx`

**Interfaces:**
- Consumes: `skeletonsFor`, `sceneOrigin`, `sceneVersion`, `summarizeScene`, `selectionSummary`, `SceneElement`, `Skeleton` (Task 3); `BoardApi`, `AckResult`, `useWorkspace` (Task 6).
- Produces: `ExcalidrawLike`, `BoardDeps`, `ExcalidrawBoardApi extends BoardApi { exportBackup(): Promise<{ data: Uint8Array; encoding: 'gzip' | 'none' } | null> }`, `createBoardApi(api, deps)`, `SNAPSHOT_MAX_SIDE = 1024`; `DiagramBoard({ session })` (inside `WorkspaceProvider`), `SUMMARY_DEBOUNCE_MS = 800`, `BACKUP_INTERVAL_MS = 10000`.

- [ ] **Step 1: Write the failing adapter test**

Create `apps/web/features/interview-live/work/boardApi.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { stampAgent, type AgentMessageOf } from '../protocol/messages'
import { INTERVIEWER_STROKE, type SceneElement } from '../workspace/board'
import { SNAPSHOT_MAX_SIDE, createBoardApi, type BoardDeps, type ExcalidrawLike } from './boardApi'

function fakeBoard(elements: SceneElement[] = []) {
  const state = { elements }
  const api: ExcalidrawLike = {
    getSceneElements: () => state.elements,
    getAppState: () => ({ viewBackgroundColor: '#fff' }),
    getFiles: () => ({}),
    updateScene: vi.fn((scene) => { state.elements = [...scene.elements] }),
  }
  const deps: BoardDeps = {
    convert: vi.fn((skeletons) => skeletons.map((s) => ({ ...(s as object), id: String(s.id), type: String(s.type) }) as SceneElement)),
    exportPng: vi.fn(async () => ({ arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer }) as unknown as Blob),
    serialize: (els) => JSON.stringify({ type: 'excalidraw', elements: els }),
    restoreElements: (els) => els as SceneElement[],
    captureUpdate: 'IMMEDIATELY',
  }
  return { api, deps, state }
}

const draw = stampAgent({ type: 'board.draw', elements: [{ type: 'rectangle', id: 'n1', label: 'Client' }] }) as AgentMessageOf<'board.draw'>

describe('createBoardApi', () => {
  it('draws interviewer shapes beside the candidate drawing, tagged and undoable', () => {
    const { api, deps, state } = fakeBoard([{ id: 'c1', type: 'rectangle', x: 0, y: 0, width: 100, height: 40 }])
    expect(createBoardApi(api, deps).draw(draw)).toEqual({ ok: true })
    const skeleton = (deps.convert as ReturnType<typeof vi.fn>).mock.calls[0][0][0]
    expect(skeleton).toMatchObject({ x: 180, strokeColor: INTERVIEWER_STROKE })
    expect(state.elements.at(-1)?.customData).toEqual({ author: 'interviewer' })
    expect(api.updateScene).toHaveBeenCalledWith(expect.objectContaining({ captureUpdate: 'IMMEDIATELY' }))
  })

  it('exports a PNG no larger than 1024px, and nothing for an empty board', async () => {
    const empty = fakeBoard()
    expect(await createBoardApi(empty.api, empty.deps).snapshotPng()).toBeNull()
    const { api, deps } = fakeBoard([{ id: 'c1', type: 'ellipse', x: 0, y: 0 }])
    const png = await createBoardApi(api, deps).snapshotPng()
    expect(png).toEqual(new Uint8Array([137, 80, 78, 71]))
    expect(deps.exportPng).toHaveBeenCalledWith(expect.objectContaining({ maxWidthOrHeight: SNAPSHOT_MAX_SIDE, mimeType: 'image/png' }))
  })

  it('round-trips a backup through restore and ignores a corrupt one', async () => {
    const source = fakeBoard([{ id: 'c1', type: 'diamond', x: 0, y: 0 }])
    const backup = await createBoardApi(source.api, source.deps).exportBackup()
    expect(backup).not.toBeNull()
    const target = fakeBoard()
    const board = createBoardApi(target.api, target.deps)
    await board.restore(backup!.data, { encoding: backup!.encoding })
    expect(target.state.elements.map((e) => e.id)).toEqual(['c1'])
    await expect(board.restore(new Uint8Array([1, 2, 3]), { encoding: 'none' })).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && pnpm vitest run features/interview-live/work/boardApi.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `boardApi.ts`**

```ts
/**
 * Applies the interviewer's whiteboard actions to Excalidraw and produces what the agent reads (a PNG
 * snapshot, a compressed scene backup). The Excalidraw functions arrive as `deps`, so this module never
 * loads the browser-only library and tests drive it with fakes.
 */
import type { AgentMessageOf } from '../protocol/messages'
import { sceneOrigin, skeletonsFor, type SceneElement, type Skeleton } from '../workspace/board'
import type { AckResult, BoardApi } from '../workspace/WorkspaceProvider'

export interface ExcalidrawLike {
  getSceneElements(): readonly SceneElement[]
  getAppState(): Record<string, unknown>
  getFiles(): Record<string, unknown>
  updateScene(scene: { elements: readonly SceneElement[]; captureUpdate?: unknown }): void
}

export interface BoardDeps {
  convert(skeletons: Skeleton[]): SceneElement[]
  exportPng(opts: {
    elements: readonly SceneElement[]
    appState: Record<string, unknown>
    files: Record<string, unknown>
    maxWidthOrHeight: number
    mimeType: 'image/png'
  }): Promise<Blob>
  serialize(elements: readonly SceneElement[], appState: Record<string, unknown>, files: Record<string, unknown>): string
  restoreElements(elements: unknown[]): SceneElement[]
  /** Excalidraw's CaptureUpdateAction.IMMEDIATELY: makes interviewer drawings undoable. */
  captureUpdate: unknown
}

export const SNAPSHOT_MAX_SIDE = 1024

export interface ExcalidrawBoardApi extends BoardApi {
  exportBackup(): Promise<{ data: Uint8Array; encoding: 'gzip' | 'none' } | null>
}

const live = (elements: readonly SceneElement[]) => elements.filter((e) => !e.isDeleted)

async function gzip(bytes: Uint8Array): Promise<{ data: Uint8Array; encoding: 'gzip' | 'none' }> {
  if (typeof CompressionStream === 'undefined') return { data: bytes, encoding: 'none' }
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))
  return { data: new Uint8Array(await new Response(stream).arrayBuffer()), encoding: 'gzip' }
}

async function gunzip(bytes: Uint8Array, encoding: string | undefined): Promise<Uint8Array> {
  if (encoding !== 'gzip') return bytes
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export function createBoardApi(api: ExcalidrawLike, deps: BoardDeps): ExcalidrawBoardApi {
  return {
    draw(m: AgentMessageOf<'board.draw'>): AckResult {
      const existing = api.getSceneElements()
      const added = deps
        .convert(skeletonsFor(m.elements, sceneOrigin(live(existing))))
        .map((e) => ({ ...e, customData: { ...e.customData, author: 'interviewer' } }))
      api.updateScene({ elements: [...existing, ...added], captureUpdate: deps.captureUpdate })
      return { ok: true }
    },
    async snapshotPng() {
      const elements = live(api.getSceneElements())
      if (!elements.length) return null
      const blob = await deps.exportPng({
        elements,
        appState: { ...api.getAppState(), exportBackground: true },
        files: api.getFiles(),
        maxWidthOrHeight: SNAPSHOT_MAX_SIDE,
        mimeType: 'image/png',
      })
      return new Uint8Array(await blob.arrayBuffer())
    },
    async exportBackup() {
      const elements = live(api.getSceneElements())
      if (!elements.length) return null
      return gzip(new TextEncoder().encode(deps.serialize(elements, api.getAppState(), api.getFiles())))
    },
    async restore(data, attributes) {
      try {
        const json = JSON.parse(new TextDecoder().decode(await gunzip(data, attributes.encoding))) as { elements?: unknown[] }
        api.updateScene({ elements: deps.restoreElements(json.elements ?? []), captureUpdate: deps.captureUpdate })
      } catch {
        // a corrupt backup leaves the board as it is
      }
    },
    hasContent: () => live(api.getSceneElements()).length > 0,
  }
}
```

- [ ] **Step 4: Rewrite `DiagramBoard.tsx`**

```tsx
'use client'

import dynamic from 'next/dynamic'
import { useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import '@excalidraw/excalidraw/index.css'
import type { LiveSession } from '../session/types'
import { sceneVersion, selectionSummary, summarizeScene, type SceneElement } from '../workspace/board'
import { useWorkspace } from '../workspace/WorkspaceProvider'
import { createBoardApi, type ExcalidrawBoardApi, type ExcalidrawLike } from './boardApi'

const Excalidraw = dynamic(async () => (await import('@excalidraw/excalidraw')).Excalidraw, {
  ssr: false,
  loading: () => <div data-motion className="h-full animate-pulse bg-panel" />,
})

type ExcalidrawProps = React.ComponentProps<typeof import('@excalidraw/excalidraw').Excalidraw>
type ExcalidrawApi = Parameters<NonNullable<ExcalidrawProps['excalidrawAPI']>>[0]

export const SUMMARY_DEBOUNCE_MS = 800
export const BACKUP_INTERVAL_MS = 10_000

/** The shared Excalidraw whiteboard. Sends a text summary when the board settles and a compressed
 * backup every 10 s while it changes; registers the adapter that draws for the interviewer and
 * answers snapshot requests; offers Ask about selected shapes. */
export function DiagramBoard({ session }: { session: LiveSession }) {
  const { registerBoard, askAbout } = useWorkspace()
  const { resolvedTheme } = useTheme()
  const raw = useRef<ExcalidrawApi | null>(null)
  const board = useRef<ExcalidrawBoardApi | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const version = useRef(0)
  const lastSummary = useRef('')
  const lastBackup = useRef(-1)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
    registerBoard(null)
  }, [registerBoard])

  useEffect(() => {
    const id = setInterval(() => {
      const ex = raw.current
      const b = board.current
      if (!ex || !b) return
      const v = sceneVersion(ex.getSceneElements() as unknown as SceneElement[])
      if (v === lastBackup.current) return
      lastBackup.current = v
      void b.exportBackup().then((backup) => {
        if (backup) void session.sendBytes('board.backup', backup.data, { encoding: backup.encoding })
      })
    }, BACKUP_INTERVAL_MS)
    return () => clearInterval(id)
  }, [session])

  async function onApi(ex: ExcalidrawApi) {
    raw.current = ex
    const lib = await import('@excalidraw/excalidraw')
    const adapter = createBoardApi(ex as unknown as ExcalidrawLike, {
      convert: (skeletons) => lib.convertToExcalidrawElements(skeletons as never) as unknown as SceneElement[],
      exportPng: (opts) => lib.exportToBlob(opts as never),
      serialize: (elements, appState, files) => lib.serializeAsJSON(elements as never, appState as never, files as never, 'local'),
      restoreElements: (elements) => lib.restoreElements(elements as never, null) as unknown as SceneElement[],
      captureUpdate: lib.CaptureUpdateAction.IMMEDIATELY,
    })
    board.current = adapter
    registerBoard(adapter)
  }

  return (
    <div className="relative h-full">
      <Excalidraw
        theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
        excalidrawAPI={(ex) => void onApi(ex)}
        onChange={(elements, appState) => {
          const ids = appState.selectedElementIds as Record<string, boolean>
          setSelected(Object.keys(ids).length ? selectionSummary(elements, ids) : null)
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => {
            const text = summarizeScene(elements)
            if (text === lastSummary.current) return
            lastSummary.current = text
            version.current += 1
            session.send({ type: 'board.summary', version: version.current, text })
          }, SUMMARY_DEBOUNCE_MS)
        }}
      />
      {selected ? (
        <button
          type="button"
          onClick={() => {
            askAbout({ surface: 'board', quote: selected })
            setSelected(null)
          }}
          className="absolute right-3 top-14 z-10 h-8 rounded-full bg-foreground px-3 text-[12.5px] text-background shadow-hero"
        >
          Ask about selection
        </button>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/web && pnpm vitest run features/interview-live/work/boardApi.test.ts`
Expected: PASS (3 tests). Then `cd apps/web && pnpm typecheck` — expected: no errors in `DiagramBoard.tsx` (the `as never` casts bridge Excalidraw's branded element types).

---

### Task 10: Transcript bubbles and the Ask pill

**Files:**
- Create: `apps/web/features/interview-live/work/TranscriptBubbles.tsx`
- Create: `apps/web/features/interview-live/work/AskPill.tsx`
- Create: `apps/web/features/interview-live/work/TranscriptBubbles.test.tsx`

**Interfaces:**
- Consumes: `TranscriptSegment` (Task 2), `useWorkspace` (Task 6).
- Produces: `TranscriptBubbles({ segments: TranscriptSegment[]; interviewerName: string })`, `AskPill()` (inside `WorkspaceProvider`).

- [ ] **Step 1: Write the failing test**

Create `apps/web/features/interview-live/work/TranscriptBubbles.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MockLiveSession } from '../session/MockLiveSession'
import type { TranscriptSegment } from '../session/transcript'
import { WorkspaceProvider, useWorkspace } from '../workspace/WorkspaceProvider'
import { AskPill } from './AskPill'
import { TranscriptBubbles } from './TranscriptBubbles'

const seg = (id: string, speaker: TranscriptSegment['speaker'], text: string, final = true): TranscriptSegment => ({ id, speaker, text, final, at: 1 })

describe('TranscriptBubbles', () => {
  it('shows an empty state', () => {
    render(<TranscriptBubbles segments={[]} interviewerName="Asha" />)
    expect(screen.getByText(/conversation will appear here/i)).toBeInTheDocument()
  })

  it('labels each run once, keeps interim words dim and shows notices as chips', () => {
    render(
      <TranscriptBubbles
        interviewerName="Asha"
        segments={[seg('a', 'interviewer', 'Hi.'), seg('b', 'interviewer', 'Ready?'), seg('c', 'candidate', 'Yes, I', false), seg('n', 'system', 'Tab change logged')]}
      />,
    )
    expect(screen.getAllByText('Asha')).toHaveLength(1)
    expect(screen.getByText('You')).toBeInTheDocument()
    expect(screen.getByText('Yes, I')).toHaveAttribute('data-final', 'false')
    expect(screen.getByRole('note')).toHaveTextContent('Tab change logged')
  })
})

describe('AskPill', () => {
  it('shows the pending selection and clears it', async () => {
    let ws: ReturnType<typeof useWorkspace> | null = null
    function Probe() { ws = useWorkspace(); return null }
    render(<WorkspaceProvider session={new MockLiveSession()}><AskPill /><Probe /></WorkspaceProvider>)
    expect(screen.queryByText(/asking about/i)).not.toBeInTheDocument()
    act(() => ws!.askAbout({ surface: 'code', quote: 'for c in s:' }))
    expect(screen.getByRole('status')).toHaveTextContent('for c in s:')
    await userEvent.click(screen.getByRole('button', { name: 'Clear the selection' }))
    expect(screen.queryByText(/asking about/i)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && pnpm vitest run features/interview-live/work/TranscriptBubbles.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `TranscriptBubbles.tsx`**

```tsx
'use client'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils/cn'
import type { TranscriptSegment } from '../session/transcript'

/** The conversation as chat bubbles: the interviewer on the left, the candidate on the right, interim
 * words dimmed until final, room notices as centred mono chips. Follows the newest line. */
export function TranscriptBubbles({ segments, interviewerName }: { segments: TranscriptSegment[]; interviewerName: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const last = segments[segments.length - 1]

  // DOM write, not state: scrolling to the newest line doesn't belong in component state.
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [segments.length, last?.text])

  return (
    <div
      ref={ref}
      role="log"
      aria-label="Conversation transcript"
      tabIndex={0}
      className="flex h-full min-h-0 flex-col gap-1.5 overflow-y-auto py-2 text-[13.5px] leading-[1.5] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {segments.length === 0 ? (
        <p className="m-auto text-center text-[13px] text-faint">The conversation will appear here.</p>
      ) : (
        segments.map((s, i) => {
          if (s.speaker === 'system') {
            return (
              <p key={s.id} role="note" className="m-0 my-1 self-center rounded-full border border-dashed border-line-4 px-2.5 py-1 text-center font-mono text-[10.5px] uppercase tracking-[0.06em] text-faint">
                {s.text}
              </p>
            )
          }
          const mine = s.speaker === 'candidate'
          const runStart = i === 0 || segments[i - 1].speaker !== s.speaker
          return (
            <div key={s.id} className={cn('flex max-w-[88%] flex-col', mine ? 'items-end self-end' : 'items-start self-start')}>
              {runStart ? (
                <span className="mb-0.5 px-1 font-mono text-[9.5px] uppercase tracking-[0.08em] text-faint">{mine ? 'You' : interviewerName}</span>
              ) : null}
              <p
                data-final={s.final}
                className={cn(
                  'm-0 whitespace-pre-wrap rounded-[16px] px-3 py-2',
                  mine ? 'rounded-br-[6px] bg-inv text-white' : 'rounded-bl-[6px] bg-panel text-foreground',
                  !s.final && 'opacity-70',
                )}
              >
                {s.text}
              </p>
            </div>
          )
        })
      )}
    </div>
  )
}
```

- [ ] **Step 4: Write `AskPill.tsx`**

```tsx
'use client'
import { X } from 'lucide-react'
import { useWorkspace } from '../workspace/WorkspaceProvider'

/** "Asking about: …" while an Ask selection waits for the candidate's next question. */
export function AskPill() {
  const { ask, clearAsk } = useWorkspace()
  if (!ask) return null
  return (
    <div role="status" className="mx-3 mt-2 flex items-start gap-2 rounded-[11px] border border-line-3 bg-card px-2.5 py-2">
      <div className="min-w-0 flex-1">
        <p className="m-0 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Asking about</p>
        <p className="m-0 line-clamp-2 text-[12.5px] text-foreground">“{ask.quote}”</p>
      </div>
      <button
        type="button"
        aria-label="Clear the selection"
        onClick={clearAsk}
        className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-panel hover:text-foreground"
      >
        <X aria-hidden className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/web && pnpm vitest run features/interview-live/work/TranscriptBubbles.test.tsx`
Expected: PASS (3 tests).

---

### Task 11: Room chrome (header, bottom bar, tool rail, proctor bars)

**Files:**
- Create: `apps/web/app/(app)/interviews/[sessionId]/live/_components/RoomHeader.tsx`
- Create: `apps/web/features/interview-live/controls/BottomBar.tsx`
- Create: `apps/web/features/interview-live/work/ToolRail.tsx`
- Create: `apps/web/features/interview-live/proctor/ProctorBars.tsx`
- Create: `apps/web/features/interview-live/controls/RoomChrome.test.tsx`

**Interfaces:**
- Consumes: `Ledger`, `formatWeighted` (Task 4), `enterFullscreen`, `requestEntireScreen` (Task 4), `useWorkspace` (Task 6), `roomEyebrow`, `formatElapsed`, `RoomMeta` (route `roomMeta.ts`), `ConfirmationDialog`, `Count`, `StatusDot`, `Waveform`, `useSpeakingLevel`.
- Produces: `RoomHeader({ meta?, ledger })`, `BottomBar({ micOn, stream, onToggleMic, onEnd })`, `ToolRail()`, `ProctorBars({ outOfFullscreen, shareStopped, toast })`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/features/interview-live/controls/RoomChrome.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RoomHeader } from '@/app/(app)/interviews/[sessionId]/live/_components/RoomHeader'
import { EMPTY_LEDGER, recordEvent } from '../proctor/ledger'
import { ProctorBars } from '../proctor/ProctorBars'
import { MockLiveSession } from '../session/MockLiveSession'
import { stampAgent } from '../protocol/messages'
import { ToolRail } from '../work/ToolRail'
import { WorkspaceProvider, useWorkspace } from '../workspace/WorkspaceProvider'
import { BottomBar } from './BottomBar'

vi.mock('../proctor/screenShare', () => ({ requestEntireScreen: vi.fn(async () => ({ ok: false, reason: 'not_entire_screen' })) }))

describe('RoomHeader', () => {
  it('shows the round, the two counters and the clock', () => {
    const ledger = recordEvent(recordEvent(EMPTY_LEDGER, 'tab_hidden', 0).ledger, 'fullscreen_exit', 9000).ledger
    render(<RoomHeader meta={{ company: 'Salescode', level: 'SDE I', round: 'DSA', interviewer: 'Asha' }} ledger={ledger} />)
    expect(screen.getByText('Salescode · SDE I · DSA')).toBeInTheDocument()
    expect(screen.getByText('1 tab changes')).toBeInTheDocument()
    expect(screen.getByText('0.5')).toBeInTheDocument()
    expect(screen.getByRole('timer')).toHaveTextContent('00:00')
  })
})

describe('BottomBar', () => {
  it('toggles the mic and ends only after confirming', async () => {
    const onEnd = vi.fn()
    const onToggleMic = vi.fn()
    render(<BottomBar micOn stream={null} onToggleMic={onToggleMic} onEnd={onEnd} />)
    await userEvent.click(screen.getByRole('button', { name: /mute microphone/i }))
    expect(onToggleMic).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'End interview' }))
    expect(onEnd).not.toHaveBeenCalled()
    const confirm = screen.getAllByRole('button', { name: 'End interview' }).at(-1)!
    await userEvent.click(confirm)
    expect(onEnd).toHaveBeenCalled()
  })
})

describe('ToolRail', () => {
  it('switches tools and shows a dot when the interviewer draws on the hidden whiteboard', async () => {
    const session = new MockLiveSession()
    let ws: ReturnType<typeof useWorkspace> | null = null
    function Probe() { ws = useWorkspace(); return null }
    render(<WorkspaceProvider session={session}><ToolRail /><Probe /></WorkspaceProvider>)
    act(() => ws!.registerBoard({ draw: () => ({ ok: true }), snapshotPng: async () => null, restore: async () => {}, hasContent: () => false }))
    await act(async () => { session.emitMessage(stampAgent({ type: 'board.draw', elements: [{ type: 'rectangle', id: 'n' }] })) })
    expect(screen.getByTestId('board-attention')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Whiteboard' }))
    expect(screen.getByRole('button', { name: 'Whiteboard' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('board-attention')).not.toBeInTheDocument()
  })
})

describe('ProctorBars', () => {
  it('shows the warning toast and both recovery bars', async () => {
    render(<ProctorBars outOfFullscreen shareStopped toast="Don't change screens while the interview is running." />)
    expect(screen.getByRole('alert')).toHaveTextContent("Don't change screens")
    await userEvent.click(screen.getByRole('button', { name: 'Return to full screen' }))
    expect(document.documentElement.requestFullscreen).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Share screen again' }))
    expect(await screen.findByText('Share your entire screen, not a window or tab.')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && pnpm vitest run features/interview-live/controls/RoomChrome.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `RoomHeader.tsx`**

```tsx
"use client";

import { useEffect, useRef } from "react";
import { Count, StatusDot } from "@/components/hud";
import { cn } from "@/lib/utils/cn";
import { formatWeighted, type Ledger } from "@/features/interview-live/proctor/ledger";
import { formatElapsed, roomEyebrow, type RoomMeta } from "./roomMeta";

/** Time since the candidate entered. Writes the DOM once a second, so the clock never re-renders the room. */
function ElapsedClock() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const start = Date.now();
    const id = window.setInterval(() => {
      if (ref.current) ref.current.textContent = formatElapsed(Date.now() - start);
    }, 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span
      role="timer"
      aria-label="Time since you joined"
      ref={ref}
      className="rounded-full border border-line-3 px-2.5 py-[3px] font-mono text-[12.5px] tabular-nums"
    >
      00:00
    </span>
  );
}

function Counter({ label, logged, children }: { label: string; logged: boolean; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
      <StatusDot state={logged ? "warn" : "idle"} srLabel={logged ? "Logged" : "None"} />
      {label}
      <span aria-hidden className="h-px w-3 bg-line-3" />
      <span className={cn("text-[12.5px] tabular-nums", logged ? "text-foreground" : "text-faint")}>{children}</span>
    </span>
  );
}

/** The live room's header (spec §10): the round, the live dot, the two proctoring counters and the clock. No countdown. */
export function RoomHeader({ meta, ledger }: { meta?: RoomMeta; ledger: Ledger }) {
  return (
    <header className="flex h-12 flex-none items-center gap-4 border-b border-line-2 px-4 text-[13px]">
      <span className="iq-eyebrow min-w-0 truncate">{roomEyebrow(meta)}</span>
      <StatusDot state="live" label="Live" className="text-muted-foreground" />
      <div className="ml-auto flex items-center gap-4">
        <Counter label="Tab changes" logged={ledger.tabChanges > 0}>
          <Count n={ledger.tabChanges} label={`${ledger.tabChanges} tab changes`} />
        </Counter>
        <Counter label="Screen changes" logged={ledger.screenChanges > 0}>
          <span aria-hidden>{formatWeighted(ledger.screenChanges)}</span>
          <span className="sr-only">{`${ledger.screenChanges} screen changes`}</span>
        </Counter>
        <ElapsedClock />
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Write `BottomBar.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { Mic, MicOff, PhoneOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { Waveform } from '@/components/visualizations/Waveform'
import { cn } from '@/lib/utils/cn'
import { useSpeakingLevel } from '../media/useSpeakingLevel'

/** The bottom row (spec §10): the mic toggle with a level meter and End, centred. End asks first. */
export function BottomBar({
  micOn,
  stream,
  onToggleMic,
  onEnd,
}: {
  micOn: boolean
  stream: MediaStream | null
  onToggleMic: () => void
  onEnd: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const speaking = useSpeakingLevel(stream, micOn)

  return (
    <div className="flex flex-none items-center justify-center gap-3 border-t border-line-2 bg-card px-4 py-3">
      <Button
        type="button"
        variant="outline"
        aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
        aria-pressed={!micOn}
        onClick={onToggleMic}
        className="h-10 gap-2 rounded-full border-line-3 px-4 text-[13px] aria-pressed:border-faint-2 aria-pressed:bg-panel"
      >
        {micOn ? <Mic aria-hidden className="h-4 w-4" /> : <MicOff aria-hidden className="h-4 w-4" />}
        <Waveform bars={6} height={12} animated={speaking} className={cn('transition-opacity', !speaking && 'opacity-30')} />
        {micOn ? 'Mute' : 'Unmute'}
      </Button>
      <Button type="button" onClick={() => setConfirming(true)} className="h-10 gap-2 rounded-full px-5 text-[13px]">
        <PhoneOff aria-hidden className="h-4 w-4" />
        End interview
      </Button>
      <ConfirmationDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="End the interview?"
        description="The round ends for good, and you can't rejoin it."
        confirmLabel="End interview"
        destructive
        onConfirm={onEnd}
      />
    </div>
  )
}
```

- [ ] **Step 5: Write `ToolRail.tsx`**

```tsx
'use client'
import { Code2, PenTool } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import { useWorkspace, type Surface } from '../workspace/WorkspaceProvider'

const TOOLS: { id: Surface; label: string; name: string; Icon: typeof Code2 }[] = [
  { id: 'code', label: 'Code', name: 'Code editor', Icon: Code2 },
  { id: 'board', label: 'Board', name: 'Whiteboard', Icon: PenTool },
]

/** The tool buttons down the right edge (spec §10). Both surfaces stay mounted; this only switches
 * which one shows. A dot marks the whiteboard when the interviewer drew there while it was hidden. */
export function ToolRail() {
  const { surface, setSurface, boardAttention } = useWorkspace()
  return (
    <nav aria-label="Tools" className="flex flex-col items-center gap-1.5 border-l border-line-2 py-2">
      {TOOLS.map(({ id, label, name, Icon }) => (
        <button
          key={id}
          type="button"
          aria-label={name}
          aria-pressed={surface === id}
          onClick={() => setSurface(id)}
          className={cn(
            'relative flex h-12 w-11 flex-col items-center justify-center gap-0.5 rounded-[11px] text-muted-foreground transition-colors hover:text-foreground',
            surface === id && 'bg-panel text-foreground',
          )}
        >
          <Icon aria-hidden className="h-4 w-4" />
          <span aria-hidden className="font-mono text-[9px] uppercase tracking-[0.08em]">{label}</span>
          {id === 'board' && boardAttention ? (
            <span data-testid="board-attention" className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-brand" />
          ) : null}
        </button>
      ))}
    </nav>
  )
}
```

- [ ] **Step 6: Write `ProctorBars.tsx`**

```tsx
'use client'
import { useState } from 'react'
import { StatusDot } from '@/components/hud'
import { Button } from '@/components/ui/button'
import { enterFullscreen } from './keyboardLock'
import { requestEntireScreen } from './screenShare'

function Bar({ text, action, onAction }: { text: string; action: string; onAction: () => void }) {
  return (
    <div role="status" className="flex flex-none items-center gap-3 border-b border-line-2 bg-panel px-4 py-2 text-[13px]">
      <StatusDot state="warn" srLabel="Warning" />
      <span className="min-w-0 flex-1">{text}</span>
      <Button type="button" variant="outline" className="h-8 rounded-full border-line-3 px-3 text-[12.5px]" onClick={onAction}>
        {action}
      </Button>
    </div>
  )
}

/** The proctoring warnings (spec §7, §10): a toast on each counted event, and a bar for as long as the
 * candidate is out of full screen or not sharing. The round keeps running. */
export function ProctorBars({ outOfFullscreen, shareStopped, toast }: { outOfFullscreen: boolean; shareStopped: boolean; toast: string | null }) {
  const [shareError, setShareError] = useState<string | null>(null)

  async function reshare() {
    const r = await requestEntireScreen()
    if (r.ok) setShareError(null)
    else setShareError(r.reason === 'not_entire_screen' ? 'Share your entire screen, not a window or tab.' : 'Screen sharing was blocked. Allow it and try again.')
  }

  return (
    <>
      {toast ? (
        <div role="alert" className="pointer-events-none fixed left-1/2 top-16 z-[70] -translate-x-1/2 rounded-full border border-line-3 bg-card px-4 py-2 text-[13px] shadow-hero">
          {toast}
        </div>
      ) : null}
      {outOfFullscreen ? (
        <Bar text="You're out of full screen. Leaving it is counted." action="Return to full screen" onAction={() => void enterFullscreen().catch(() => {})} />
      ) : null}
      {shareStopped ? (
        <Bar text={shareError ?? 'Screen sharing stopped. Share your entire screen again.'} action="Share screen again" onAction={() => void reshare()} />
      ) : null}
    </>
  )
}
```

- [ ] **Step 7: Add the interviewer name to the room meta**

`RoomHeader`'s test passes `interviewer`, and Task 12 reads it. In `apps/web/app/(app)/interviews/[sessionId]/live/_components/roomMeta.ts`, replace:

```ts
export interface RoomMeta {
  company: string;
  level: string;
  round: string;
}

export function roomMetaFrom(session: InterviewSession | undefined): RoomMeta | undefined {
  if (!session) return undefined;
  return { company: companyLabel(session), level: levelLabel(session.level), round: roundLabel(session.roundType) };
}
```

with:

```ts
export interface RoomMeta {
  company: string;
  level: string;
  round: string;
  /** The persona's name from the briefing, or "Interviewer". */
  interviewer: string;
}

export function roomMetaFrom(session: InterviewSession | undefined): RoomMeta | undefined {
  if (!session) return undefined;
  return {
    company: companyLabel(session),
    level: levelLabel(session.level),
    round: roundLabel(session.roundType),
    interviewer: session.briefing?.interviewerName ?? "Interviewer",
  };
}
```

In `roomMeta.test.ts`, replace:

```ts
    expect(meta).toEqual({ company: "Meesho", level: "SDE I", round: "DSA" });
```

with:

```ts
    expect(meta).toEqual({ company: "Meesho", level: "SDE I", round: "DSA", interviewer: "Interviewer" });
```

and add inside the `describe`:

```ts
  it("names the interviewer from the briefing", () => {
    const meta = roomMetaFrom({
      company: "meesho", companyName: "Meesho", level: "sde1", roundType: "dsa",
      briefing: { interviewerName: "Asha", interviewerStyle: "calm", format: "coding", durationMins: 45 },
    } as InterviewSession);
    expect(meta?.interviewer).toBe("Asha");
  });
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd apps/web && pnpm vitest run features/interview-live/controls/RoomChrome.test.tsx "app/(app)/interviews/[sessionId]/live/_components/roomMeta.test.ts"`
Expected: PASS.

---

### Task 12: Compose the room (layout, work area, LiveView)

**Files:**
- Create: `apps/web/features/interview-live/workspace/WorkspaceSplit.tsx`
- Create: `apps/web/features/interview-live/workspace/WorkspaceSplit.test.tsx`
- Create: `apps/web/features/interview-live/media/InterviewerStrip.tsx`
- Modify (rewrite): `apps/web/features/interview-live/work/WorkArea.tsx`, `apps/web/features/interview-live/work/WorkArea.test.tsx`
- Modify (rewrite): `apps/web/app/(app)/interviews/[sessionId]/live/_components/LiveView.tsx`
- Create: `apps/web/app/(app)/interviews/[sessionId]/live/_components/LiveView.test.tsx`
- Delete: `features/interview-live/work/TranscriptPanel.tsx`, `features/interview-live/work/TranscriptPanel.test.tsx`, `features/interview-live/controls/BottomDrawer.tsx`

**Interfaces:**
- Consumes: everything from Tasks 5–11.
- Produces: `WorkspaceSplit({ panel, work })` with `MIN_FRACTION = 0.12`, `MAX_FRACTION = 0.8`, `DEFAULT_FRACTION = 0.2`; `InterviewerStrip({ name, agentState, stream, micOn })`; `WorkArea({ session })`; `LiveView({ sessionId, meta? })`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/features/interview-live/workspace/WorkspaceSplit.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MockLiveSession } from '../session/MockLiveSession'
import { WorkspaceProvider, useWorkspace } from './WorkspaceProvider'
import { DEFAULT_FRACTION, WorkspaceSplit } from './WorkspaceSplit'

let ws: ReturnType<typeof useWorkspace> | null = null
function Probe() { ws = useWorkspace(); return null }
function mount() {
  render(
    <WorkspaceProvider session={new MockLiveSession()}>
      <WorkspaceSplit panel={<div>panel</div>} work={<div>work</div>} />
      <Probe />
    </WorkspaceProvider>,
  )
}

describe('WorkspaceSplit', () => {
  it('starts the panel at 20% and resizes it from the keyboard', () => {
    mount()
    const sep = screen.getByRole('separator', { name: 'Resize problem panel' })
    expect(sep).toHaveAttribute('aria-valuenow', String(DEFAULT_FRACTION * 100))
    fireEvent.keyDown(sep, { key: 'ArrowDown' })
    expect(sep).toHaveAttribute('aria-valuenow', '25')
  })

  it('hides the work area while the panel fills the right side, and the separator in any expanded mode', () => {
    mount()
    act(() => ws!.setExpanded('panel'))
    expect(screen.getByText('work').parentElement).toHaveClass('hidden')
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
  })
})
```

Replace `apps/web/features/interview-live/work/WorkArea.test.tsx` with:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MockLiveSession } from '../session/MockLiveSession'
import { WorkspaceProvider, useWorkspace } from '../workspace/WorkspaceProvider'
import { WorkArea } from './WorkArea'

vi.mock('./CodeEditor', () => ({ CodeEditor: () => <div data-testid="code-editor" /> }))
vi.mock('./DiagramBoard', () => ({ DiagramBoard: () => <div data-testid="diagram-board" /> }))

describe('WorkArea', () => {
  it('keeps both surfaces mounted, shows the chosen one, and fills the right side on request', async () => {
    const session = new MockLiveSession()
    let ws: ReturnType<typeof useWorkspace> | null = null
    function Probe() { ws = useWorkspace(); return null }
    render(<WorkspaceProvider session={session}><WorkArea session={session} /><Probe /></WorkspaceProvider>)
    expect(screen.getByTestId('code-editor').parentElement).not.toHaveClass('hidden')
    expect(screen.getByTestId('diagram-board').parentElement).toHaveClass('hidden')
    act(() => ws!.setSurface('board'))
    expect(screen.getByRole('region', { name: 'Whiteboard' })).toBeInTheDocument()
    expect(screen.getByTestId('code-editor').parentElement).toHaveClass('hidden')
    await userEvent.click(screen.getByRole('button', { name: 'Expand work area' }))
    expect(ws!.expanded).toBe('work')
  })
})
```

Create `apps/web/app/(app)/interviews/[sessionId]/live/_components/LiveView.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LiveSessionProvider, useLiveSession } from "@/features/interview-live/session/LiveSessionProvider";
import { MockLiveSession } from "@/features/interview-live/session/MockLiveSession";
import { stampAgent } from "@/features/interview-live/protocol/messages";
import { LiveView } from "./LiveView";

vi.mock("@/features/interview-live/work/CodeEditor", () => ({ CodeEditor: () => <div data-testid="code-editor" /> }));
vi.mock("@/features/interview-live/work/DiagramBoard", () => ({ DiagramBoard: () => <div data-testid="diagram-board" /> }));

let live: ReturnType<typeof useLiveSession> | null = null;
function Probe() {
  live = useLiveSession();
  return null;
}

async function mount() {
  const session = new MockLiveSession();
  await session.connect("s1");
  (document as unknown as { fullscreenElement: Element | null }).fullscreenElement = document.documentElement;
  render(
    <LiveSessionProvider sessionId="s1" session={session}>
      <Probe />
      <LiveView sessionId="s1" meta={{ company: "Salescode", level: "SDE I", round: "DSA", interviewer: "Asha" }} />
    </LiveSessionProvider>,
  );
  act(() => {
    live!.send({ type: "START_CHECKS" });
    live!.send({ type: "CHECKS_PASSED" });
    live!.send({ type: "CONNECTED" });
  });
  return session;
}

describe("LiveView", () => {
  it("lays out the transcript, the problem panel, the work area, the tools and the bottom bar", async () => {
    await mount();
    expect(screen.getByRole("log", { name: "Conversation transcript" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Problem" })).toBeInTheDocument();
    expect(screen.getByTestId("code-editor")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Tools" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /mute microphone/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End interview" })).toBeInTheDocument();
    expect(screen.getByText("Asha")).toBeInTheDocument();
  });

  it("shows a problem the interviewer puts on screen", async () => {
    const session = await mount();
    await act(async () => {
      session.emitMessage(stampAgent({ type: "panel.show_problem", item_id: "slot-1", label: "Problem 1", kind: "problem", statement: "Count the islands in the grid.", examples: [] }));
    });
    expect(screen.getByRole("tab", { name: "Problem 1" })).toBeInTheDocument();
    expect(screen.getByText("Count the islands in the grid.")).toBeInTheDocument();
  });

  it("End asks to confirm, then asks the interviewer to close the round", async () => {
    const session = await mount();
    await userEvent.click(screen.getByRole("button", { name: "End interview" }));
    await userEvent.click(screen.getAllByRole("button", { name: "End interview" }).at(-1)!);
    expect(session.sentOf("session.end_request")).toHaveLength(1);
    expect(live!.state).toBe("ending");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/web && pnpm vitest run features/interview-live/workspace/WorkspaceSplit.test.tsx features/interview-live/work/WorkArea.test.tsx "app/(app)/interviews/[sessionId]/live/_components/LiveView.test.tsx"`
Expected: FAIL — `WorkspaceSplit` missing; `WorkArea` and `LiveView` still have the old layout.

- [ ] **Step 3: Write `WorkspaceSplit.tsx`**

```tsx
'use client'
import { useRef, useState } from 'react'
import { cn } from '@/lib/utils/cn'
import { useWorkspace } from './WorkspaceProvider'

export const MIN_FRACTION = 0.12
export const MAX_FRACTION = 0.8
export const DEFAULT_FRACTION = 0.2
const STEP = 0.05

const clamp = (n: number) => Math.min(MAX_FRACTION, Math.max(MIN_FRACTION, n))

/** The right side's vertical split (spec §10): the problem panel on top (20% to start, drag or arrow
 * keys to resize) and the work area below. Either can fill the side; both stay mounted. */
export function WorkspaceSplit({ panel, work }: { panel: React.ReactNode; work: React.ReactNode }) {
  const { expanded } = useWorkspace()
  const [fraction, setFraction] = useState(DEFAULT_FRACTION)
  const box = useRef<HTMLDivElement>(null)

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId) || !box.current) return
    const r = box.current.getBoundingClientRect()
    if (r.height > 0) setFraction(clamp((e.clientY - r.top) / r.height))
  }

  const panelStyle: React.CSSProperties =
    expanded === 'panel' ? { flex: '1 1 0%' } : expanded === 'work' ? { flex: '0 0 auto' } : { flex: `0 0 ${fraction * 100}%` }

  return (
    <div ref={box} className="flex h-full min-h-0 flex-col">
      <div style={panelStyle} className="min-h-0">{panel}</div>
      {expanded === 'none' ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize problem panel"
          aria-valuenow={Math.round(fraction * 100)}
          aria-valuemin={MIN_FRACTION * 100}
          aria-valuemax={MAX_FRACTION * 100}
          tabIndex={0}
          onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
          onPointerMove={onPointerMove}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setFraction((f) => clamp(f + STEP))
            if (e.key === 'ArrowUp') setFraction((f) => clamp(f - STEP))
          }}
          className="group flex h-2 flex-none cursor-row-resize items-center justify-center focus-visible:outline-none"
        >
          <span aria-hidden className="h-[3px] w-10 rounded-full bg-line-3 transition-colors group-hover:bg-faint-2 group-focus-visible:bg-ring" />
        </div>
      ) : (
        <div aria-hidden className="h-2 flex-none" />
      )}
      <div className={cn('min-h-0 flex-1', expanded === 'panel' && 'hidden')}>{work}</div>
    </div>
  )
}
```

- [ ] **Step 4: Write `InterviewerStrip.tsx`**

```tsx
'use client'
import { Waveform } from '@/components/visualizations/Waveform'
import { cn } from '@/lib/utils/cn'
import type { AgentState } from '../session/types'
import { AvatarBubble } from './AvatarBubble'
import { CameraTile } from './CameraTile'

const STATE_LABEL: Record<AgentState, string> = {
  absent: 'Connecting',
  initializing: 'Joining',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
}

/** The top of the left column: the interviewer's avatar, waveform and state, and a small self-view. */
export function InterviewerStrip({ name, agentState, stream, micOn }: { name: string; agentState: AgentState; stream: MediaStream | null; micOn: boolean }) {
  const speaking = agentState === 'speaking'
  return (
    <div className="flex flex-none items-center gap-3 border-b border-line-2 px-3 py-3">
      <div className="h-[38px] w-[38px] flex-none">
        <AvatarBubble name={name} speaking={speaking} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate text-[13.5px]">{name}</p>
        <p className="m-0 flex h-4 items-center gap-2 text-foreground">
          <Waveform bars={14} height={12} animated={speaking} className={cn('transition-opacity', !speaking && 'opacity-25')} />
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{STATE_LABEL[agentState]}</span>
        </p>
      </div>
      <div className="h-[54px] w-[72px] flex-none">
        <CameraTile stream={stream} micOn={micOn} />
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Rewrite `WorkArea.tsx`**

```tsx
'use client'

import { Maximize2, Minimize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils/cn'
import type { LiveSession } from '../session/types'
import { useWorkspace } from '../workspace/WorkspaceProvider'
import { CodeEditor } from './CodeEditor'
import { DiagramBoard } from './DiagramBoard'

/** The work area: the code editor or the whiteboard (chosen in the tool rail). Both stay mounted so
 * Monaco and Excalidraw keep their state; the expand button makes the area fill the right side. */
export function WorkArea({ session }: { session: LiveSession }) {
  const { surface, expanded, setExpanded } = useWorkspace()
  const filled = expanded === 'work'
  const title = surface === 'code' ? 'Code editor' : 'Whiteboard'

  return (
    <section aria-label={title} className="flex h-full min-h-0 flex-col overflow-hidden rounded-[14px] border border-line-2 bg-card">
      <header className="flex h-[38px] flex-none items-center gap-2 border-b border-line-2 px-3">
        <h2 className="m-0 font-mono text-[11px] font-normal uppercase tracking-[0.08em] text-muted-foreground">{surface === 'code' ? 'Code' : 'Whiteboard'}</h2>
        <span aria-hidden className="h-px w-4 bg-line-3" />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={filled ? 'Restore work area' : 'Expand work area'}
          aria-pressed={filled}
          onClick={() => setExpanded(filled ? 'none' : 'work')}
          className="ml-auto h-7 w-7 text-muted-foreground hover:text-foreground"
        >
          {filled ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </Button>
      </header>
      <div className="relative min-h-0 flex-1">
        <div className={cn('absolute inset-0', surface !== 'code' && 'hidden')}>
          <CodeEditor session={session} />
        </div>
        <div className={cn('absolute inset-0', surface !== 'board' && 'hidden')}>
          <DiagramBoard session={session} />
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 6: Rewrite `LiveView.tsx`**

```tsx
'use client'

import { BottomBar } from '@/features/interview-live/controls/BottomBar'
import { InterviewerStrip } from '@/features/interview-live/media/InterviewerStrip'
import { useLocalMedia } from '@/features/interview-live/media/useLocalMedia'
import { ProblemPanel } from '@/features/interview-live/panel/ProblemPanel'
import { ProctorBars } from '@/features/interview-live/proctor/ProctorBars'
import { useProctor } from '@/features/interview-live/proctor/useProctor'
import { useLiveSession } from '@/features/interview-live/session/useLiveSession'
import { AskPill } from '@/features/interview-live/work/AskPill'
import { ToolRail } from '@/features/interview-live/work/ToolRail'
import { TranscriptBubbles } from '@/features/interview-live/work/TranscriptBubbles'
import { WorkArea } from '@/features/interview-live/work/WorkArea'
import { WorkspaceProvider } from '@/features/interview-live/workspace/WorkspaceProvider'
import { WorkspaceSplit } from '@/features/interview-live/workspace/WorkspaceSplit'
import { RoomHeader } from './RoomHeader'
import type { RoomMeta } from './roomMeta'

/** The live room (spec §10): the transcript column (20%), the problem panel over the work area (80%),
 * the tool rail, and the centred mic and End controls. Proctoring counts and warns; it never pauses. */
export function LiveView({ meta }: { sessionId: string; meta?: RoomMeta }) {
  const { session, transcript, agentState, requestEnd } = useLiveSession()
  const { stream, micOn, toggleMic } = useLocalMedia(session)
  const proctor = useProctor({ session, enabled: true })
  const name = meta?.interviewer ?? 'Interviewer'

  return (
    <WorkspaceProvider session={session}>
      <div className="flex h-full min-h-0 w-full flex-col">
        <RoomHeader meta={meta} ledger={proctor.ledger} />
        <ProctorBars outOfFullscreen={proctor.outOfFullscreen} shareStopped={proctor.shareStopped} toast={proctor.toast} />
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(260px,20%)_minmax(0,1fr)_56px]">
          <aside aria-label="Interviewer" className="flex min-h-0 min-w-0 flex-col border-r border-line-2">
            <InterviewerStrip name={name} agentState={agentState} stream={stream} micOn={micOn} />
            <AskPill />
            <div className="min-h-0 flex-1 px-3">
              <TranscriptBubbles segments={transcript} interviewerName={name} />
            </div>
          </aside>
          <section aria-label="Workspace" className="min-h-0 min-w-0 p-2">
            <WorkspaceSplit panel={<ProblemPanel />} work={<WorkArea session={session} />} />
          </section>
          <ToolRail />
        </div>
        <BottomBar micOn={micOn} stream={stream} onToggleMic={toggleMic} onEnd={requestEnd} />
      </div>
    </WorkspaceProvider>
  )
}
```

- [ ] **Step 7: Delete the replaced components**

Delete `features/interview-live/work/TranscriptPanel.tsx`, `features/interview-live/work/TranscriptPanel.test.tsx` and `features/interview-live/controls/BottomDrawer.tsx`. Then confirm nothing imports them:

Run: `cd apps/web && grep -rn "TranscriptPanel\|BottomDrawer" app features components`
Expected: no output.

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd apps/web && pnpm vitest run features/interview-live "app/(app)/interviews/[sessionId]/live"`
Expected: PASS.

---

### Task 13: Checks (entire-screen share, window width, Esc lock) and pre-join copy

**Files:**
- Modify: `apps/web/app/(app)/interviews/[sessionId]/live/_components/ChecksView.tsx`
- Modify: `apps/web/app/(app)/interviews/[sessionId]/live/_components/ChecksView.test.tsx`
- Modify: `apps/web/app/(app)/interviews/[sessionId]/live/_components/PrejoinView.tsx`

**Interfaces:**
- Consumes: `requestEntireScreen`, `useScreenShared`, `stopScreenShare` (Task 4), `enterFullscreen` (Task 4).
- Produces: `MIN_ROOM_WIDTH = 1024` (exported from `ChecksView.tsx`).

- [ ] **Step 1: Update the checks test**

Replace `apps/web/app/(app)/interviews/[sessionId]/live/_components/ChecksView.test.tsx` with:

```tsx
import { afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, act, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  LiveSessionProvider,
  useLiveSession,
} from "@/features/interview-live/session/LiveSessionProvider";
import { MockLiveSession } from "@/features/interview-live/session/MockLiveSession";
import { stopScreenShare } from "@/features/interview-live/proctor/screenShare";
import { ChecksView } from "./ChecksView";

async function flushTimers(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** Drives the real LiveSessionProvider machine to `checks` and renders ChecksView there, exposing
 * the machine's state for assertions (mirrors how LiveInterview renders it). */
function Harness({ sessionId }: { sessionId: string }) {
  const { state, send } = useLiveSession();
  return (
    <div>
      <span data-testid="fsm-state">{state}</span>
      {state === "prejoin" && (
        <button onClick={() => send({ type: "START_CHECKS" })}>
          drive-to-checks
        </button>
      )}
      {state === "checks" && <ChecksView sessionId={sessionId} />}
    </div>
  );
}

async function renderAtChecks(session: MockLiveSession) {
  const user = userEvent.setup();
  render(
    <LiveSessionProvider sessionId="s1" session={session}>
      <Harness sessionId="s1" />
    </LiveSessionProvider>,
  );
  await user.click(screen.getByRole("button", { name: /drive-to-checks/i }));
  await flushTimers();
  return user;
}

/** Session subclass that rejects on connect() — used to test error-handling. */
class FailingMockLiveSession extends MockLiveSession {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async connect(_sessionId: string): Promise<void> {
    throw new Error("Connection failed");
  }
}

function mockEntireScreen(surface = "monitor") {
  const track = { kind: "video", stop: vi.fn(), getSettings: () => ({ displaySurface: surface }), addEventListener: vi.fn() };
  Object.assign(navigator.mediaDevices, {
    getDisplayMedia: vi.fn(async () => ({ getTracks: () => [track], getVideoTracks: () => [track] })),
  });
}

afterEach(() => {
  stopScreenShare();
  Reflect.deleteProperty(navigator.mediaDevices, "getDisplayMedia");
});

describe("ChecksView", () => {
  it("runs and shows the five system checks", async () => {
    await renderAtChecks(new MockLiveSession());
    for (const label of ["Microphone", "Camera", "Entire screen", "Window size", "External display"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("shows each check as a readout row: steady OK dots once they pass, the share waiting, nothing pulsing", async () => {
    await renderAtChecks(new MockLiveSession());
    const list = screen.getByRole("list", { name: /system checks/i });
    await waitFor(() => expect(within(list).getAllByText("OK")).toHaveLength(4));
    expect(within(list).getByText("Warning")).toBeInTheDocument();
    expect(list.querySelector("[data-motion]")).toBeNull();
  });

  it("marks denied devices Action needed and keeps the how-to-fix message", async () => {
    const gum = vi.mocked(navigator.mediaDevices.getUserMedia);
    gum.mockRejectedValueOnce(new Error("denied")).mockRejectedValueOnce(new Error("denied"));
    await renderAtChecks(new MockLiveSession());
    const list = screen.getByRole("list", { name: /system checks/i });
    await waitFor(() => expect(within(list).getAllByText("Action needed")).toHaveLength(2));
    expect(screen.getByRole("status")).toHaveTextContent(/allow microphone and camera access/i);
    expect(screen.getByRole("button", { name: /enter interview/i })).toBeDisabled();
  });

  it("keeps Enter disabled until the entire screen is shared, and rejects a window share", async () => {
    const user = await renderAtChecks(new MockLiveSession());
    const enter = screen.getByRole("button", { name: /enter interview/i });
    expect(enter).toBeDisabled();
    mockEntireScreen("window");
    await user.click(screen.getByRole("button", { name: "Share entire screen" }));
    expect(screen.getByText(/not a window or tab/i)).toBeInTheDocument();
    mockEntireScreen();
    await user.click(screen.getByRole("button", { name: "Share entire screen" }));
    await waitFor(() => expect(enter).toBeEnabled());
  });

  it("Enter interview requests fullscreen, connects, and drives the machine to live", async () => {
    const session = new MockLiveSession();
    const connectSpy = vi.spyOn(session, "connect");
    const user = await renderAtChecks(session);
    mockEntireScreen();
    await user.click(screen.getByRole("button", { name: "Share entire screen" }));

    const enterButton = await screen.findByRole("button", { name: /enter interview/i });
    await waitFor(() => expect(enterButton).toBeEnabled());
    await user.click(enterButton);

    expect(document.documentElement.requestFullscreen).toHaveBeenCalled();
    await waitFor(() => expect(connectSpy).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(screen.getByTestId("fsm-state").textContent).toBe("live"));
  });

  it("Enter interview sends ERROR when connect() rejects", async () => {
    const user = await renderAtChecks(new FailingMockLiveSession());
    mockEntireScreen();
    await user.click(screen.getByRole("button", { name: "Share entire screen" }));

    const enterButton = await screen.findByRole("button", { name: /enter interview/i });
    await waitFor(() => expect(enterButton).toBeEnabled());
    await user.click(enterButton);

    expect(document.documentElement.requestFullscreen).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("fsm-state").textContent).toBe("error"));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && pnpm vitest run "app/(app)/interviews/[sessionId]/live/_components/ChecksView.test.tsx"`
Expected: FAIL — no "Share entire screen" button.

- [ ] **Step 3: Update `ChecksView.tsx`**

Add imports:

```tsx
import { enterFullscreen } from "@/features/interview-live/proctor/keyboardLock";
import { requestEntireScreen, useScreenShared } from "@/features/interview-live/proctor/screenShare";
```

Add below the imports:

```tsx
/** The room's layout needs a desktop-width window (spec §10). */
export const MIN_ROOM_WIDTH = 1024;

function useWideEnough(): boolean {
  const [wide, setWide] = useState(() => typeof window === "undefined" || window.innerWidth >= MIN_ROOM_WIDTH);
  useEffect(() => {
    const onResize = () => setWide(window.innerWidth >= MIN_ROOM_WIDTH);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return wide;
}
```

Give `CheckRow` an optional action (rendered under the detail):

```tsx
function CheckRow({
  label,
  status,
  detail,
  action,
}: {
  label: string;
  status: CheckStatus;
  detail: string;
  action?: React.ReactNode;
}) {
  const dot = CHECK_DOT[status];
  return (
    <li className="flex flex-col gap-1.5 border-b border-line px-[18px] py-4 last:border-b-0">
      <div className="flex items-center gap-3 font-mono text-[12px] uppercase tracking-[0.06em]">
        <p className="m-0 min-w-0 text-foreground">{label}</p>
        <span aria-hidden className="h-px min-w-4 flex-1 bg-line-2" />
        <StatusDot state={dot.state} label={dot.label} className={cn("text-[12px] tracking-[0.06em]", dot.tone)} />
      </div>
      <p className="m-0 text-[12.5px] leading-[1.5] text-muted-foreground">{detail}</p>
      {action ? <div className="pt-1">{action}</div> : null}
    </li>
  );
}
```

Inside `ChecksView`, after the camera state:

```tsx
  const shared = useScreenShared();
  const [shareError, setShareError] = useState<string | null>(null);
  const wide = useWideEnough();

  async function shareScreen() {
    const r = await requestEntireScreen();
    if (r.ok) setShareError(null);
    else if (r.reason === "not_entire_screen") setShareError("Share your entire screen, not a window or tab.");
    else if (r.reason === "unsupported") setShareError("This browser can't share your screen. Use desktop Chrome or Edge.");
    else setShareError("Screen sharing was blocked. Allow it in your browser and try again.");
  }

  const shareStatus: CheckStatus = shared ? "pass" : shareError ? "fail" : "warn";
  const shareDetail = shared
    ? "Your entire screen is shared. It stays on this device and is never recorded."
    : shareError ?? "Share your entire screen to continue. It stays on this device and is never recorded.";
```

Change `ready`:

```tsx
  const ready = micStatus === "pass" && camStatus === "pass" && shared && wide;
```

In `handleEnter`, replace `await document.documentElement.requestFullscreen();` with `await enterFullscreen();`.

Replace the intro copy `Entering switches to full screen; leaving it pauses the round.` with `Entering switches to full screen. Switching tabs, windows or screens is counted, and the interviewer will mention it.`

In the checks list, between the Camera row and the External display row, add:

```tsx
        <CheckRow
          label="Entire screen"
          status={shareStatus}
          detail={shareDetail}
          action={
            shared ? null : (
              <Button type="button" variant="outline" className="h-8 rounded-full border-line-3 px-3 text-[12.5px]" onClick={() => void shareScreen()}>
                Share entire screen
              </Button>
            )
          }
        />
        <CheckRow
          label="Window size"
          status={wide ? "pass" : "fail"}
          detail={wide ? "Your window is wide enough for the interview room." : "The interview room needs a desktop window at least 1024px wide."}
        />
```

- [ ] **Step 4: Update the pre-join copy**

In `PrejoinView.tsx`, replace the first `DONTS` entry:

```tsx
  "Don't exit full screen or switch tabs — the interview pauses and the switch is logged.",
```

with:

```tsx
  "Don't switch tabs, windows or screens. Every switch is counted, and repeated switches end the round.",
```

and replace the checkbox label text:

```tsx
              I understand the interview runs in full screen, that leaving full
              screen or switching tabs will pause it, and I agree to the rules
              above.
```

with:

```tsx
              I understand the interview runs in full screen with my entire
              screen shared, that switching tabs or screens is counted and can
              end the round, and I agree to the rules above.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd apps/web && pnpm vitest run "app/(app)/interviews/[sessionId]/live/_components"`
Expected: PASS (the pre-join test still finds "full screen" and "agree to the rules").

---

### Task 14: End screen by reason

**Files:**
- Modify (rewrite): `apps/web/app/(app)/interviews/[sessionId]/live/_components/EndedView.tsx`
- Create: `apps/web/app/(app)/interviews/[sessionId]/live/_components/EndedView.test.tsx`

**Interfaces:**
- Consumes: `useLiveSession` (`state`, `ctx.endedReason`, `ctx.endedMessage`), `EndReason`.
- Produces: `EndedView({ sessionId, meta? })` handling `ending` and the four reasons.

- [ ] **Step 1: Write the failing test**

Create `EndedView.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { EndReason } from '@/features/interview-live/protocol/messages'
import { EndedView } from './EndedView'

const h = vi.hoisted(() => ({ state: 'ended', reason: 'completed' as string | null, message: null as string | null }))
vi.mock('@/features/interview-live/session/useLiveSession', () => ({
  useLiveSession: () => ({ state: h.state, ctx: { endedReason: h.reason, endedMessage: h.message } }),
}))

function show(reason: EndReason | null, message: string | null = null, state = 'ended') {
  Object.assign(h, { reason, message, state })
  render(<EndedView sessionId="s1" />)
}

describe('EndedView', () => {
  it('waits while the interviewer says goodbye', () => {
    show(null, null, 'ending')
    expect(screen.getByRole('status')).toHaveTextContent(/ending the interview/i)
  })

  it('shows the closing line and the debrief link after a completed round', () => {
    show('completed', 'Thanks, that was great.')
    expect(screen.getByRole('heading', { name: 'Interview complete' })).toBeInTheDocument()
    expect(screen.getByText('Thanks, that was great.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /view debrief/i })).toHaveAttribute('href', '/interviews/s1/report')
  })

  it('gives the interviewer reason and says the round counts as an attempt', () => {
    show('ended_by_interviewer', 'I am ending the interview because of repeated tab switching.')
    expect(screen.getByRole('heading', { name: 'The interviewer ended the interview' })).toBeInTheDocument()
    expect(screen.getByText(/repeated tab switching/)).toBeInTheDocument()
    expect(screen.getByText('This counts as an attempt.')).toBeInTheDocument()
  })

  it('confirms a candidate end', () => {
    show('candidate_ended')
    expect(screen.getByRole('heading', { name: 'You ended the interview' })).toBeInTheDocument()
  })

  it('offers only the way back after a lost connection', () => {
    show('technical')
    expect(screen.getByRole('heading', { name: 'Connection lost' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /view debrief/i })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && pnpm vitest run "app/(app)/interviews/[sessionId]/live/_components/EndedView.test.tsx"`
Expected: FAIL — headings don't match the old copy.

- [ ] **Step 3: Rewrite `EndedView.tsx`**

```tsx
'use client'

import Link from 'next/link'
import { ArrowRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { EndReason } from '@/features/interview-live/protocol/messages'
import { useLiveSession } from '@/features/interview-live/session/useLiveSession'
import { RoomCentered } from './RoomFrame'
import { roomEyebrow, type RoomMeta } from './roomMeta'

const COPY: Record<EndReason, { title: string; body: (message: string | null) => string; note: string | null; debrief: boolean }> = {
  completed: {
    title: 'Interview complete',
    body: (m) => m ?? 'Thanks for taking the round.',
    note: "Your debrief will appear here once scoring is live.",
    debrief: true,
  },
  ended_by_interviewer: {
    title: 'The interviewer ended the interview',
    body: (m) => m ?? 'The round was ended early.',
    note: 'This counts as an attempt.',
    debrief: true,
  },
  candidate_ended: {
    title: 'You ended the interview',
    body: () => 'The round is over.',
    note: null,
    debrief: true,
  },
  technical: {
    title: 'Connection lost',
    body: () => 'The round ended because the connection dropped. You can go back to your interviews.',
    note: null,
    debrief: false,
  },
}

/** After the round (machine `ending`/`ended`), worded from how it ended (spec §10). */
export function EndedView({ sessionId, meta }: { sessionId: string; meta?: RoomMeta }) {
  const { state, ctx } = useLiveSession()

  if (state === 'ending' || !ctx.endedReason) {
    return (
      <RoomCentered className="items-center text-center">
        <div role="status" className="flex flex-col items-center gap-3">
          <Loader2 aria-hidden data-motion className="h-6 w-6 animate-spin text-faint" />
          <p className="m-0 text-[13.5px] text-muted-foreground">Ending the interview…</p>
        </div>
      </RoomCentered>
    )
  }

  const copy = COPY[ctx.endedReason]
  return (
    <RoomCentered>
      <div className="flex flex-col gap-2.5">
        <p className="iq-eyebrow m-0">{roomEyebrow(meta)}</p>
        <h1 className="m-0 text-[26px] font-normal leading-[1.1] tracking-[-0.04em] sm:text-[30px]">{copy.title}</h1>
        <p className="m-0 text-[15px] leading-[1.5] text-muted-foreground">{copy.body(ctx.endedMessage)}</p>
        {copy.note ? <p className="m-0 text-[14px] leading-[1.5] text-foreground">{copy.note}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {copy.debrief ? (
          <Button asChild className="h-11 px-5 text-[14px]">
            <Link href={`/interviews/${sessionId}/report`}>
              View debrief
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        ) : null}
        <Button asChild variant="strong" className="h-11 px-5 text-[14px]">
          <Link href="/interviews">Back to interviews</Link>
        </Button>
      </div>
    </RoomCentered>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && pnpm vitest run "app/(app)/interviews/[sessionId]/live/_components/EndedView.test.tsx"`
Expected: PASS (5 tests).

---

### Task 15: Scripted mock interviewer and local mock mode

**Files:**
- Create: `apps/web/features/interview-live/session/script.ts`
- Create: `apps/web/features/interview-live/session/ScriptedLiveSession.ts`
- Create: `apps/web/features/interview-live/session/mockMode.ts`
- Create: `apps/web/features/interview-live/session/ScriptedRoom.test.tsx`
- Modify: `apps/web/app/(app)/interviews/[sessionId]/live/_components/LiveInterview.tsx`
- Modify: `apps/web/app/(app)/interviews/[sessionId]/live/_components/LiveRoom.tsx`
- Modify: `apps/web/.env.example`

**Interfaces:**
- Consumes: `MockLiveSession` (Task 5), `stampAgent`, `newMessageId`, `AgentMessageBody`, `WebMessage` (Task 1), `AgentState`.
- Produces: `ScriptedLiveSession({ speed?: number })` (1 = real time, 0 = no delays); `script.ts` exports `Step`, `DEMO_ITEM`, `OPENING`, `askReply(quote, itemId?)`, `proctorReply(event)`, `GOODBYE`; `isMockMode(): boolean`; `LiveInterview.tsx` exports `LiveInterviewInner` and `MockRoom`.

- [ ] **Step 1: Write the failing end-to-end test**

Create `apps/web/features/interview-live/session/ScriptedRoom.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LiveInterviewInner } from '@/app/(app)/interviews/[sessionId]/live/_components/LiveInterview'
import { LiveSessionProvider, useLiveSession } from './LiveSessionProvider'
import { ScriptedLiveSession } from './ScriptedLiveSession'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/features/interview-live/work/CodeEditor', () => ({ CodeEditor: () => <div data-testid="code-editor" /> }))
vi.mock('@/features/interview-live/work/DiagramBoard', () => ({ DiagramBoard: () => <div data-testid="diagram-board" /> }))

let live: ReturnType<typeof useLiveSession> | null = null
function Probe() {
  live = useLiveSession()
  return null
}

describe('scripted interview room', () => {
  it('runs the scripted round through the protocol and ends on the candidate request', async () => {
    const session = new ScriptedLiveSession({ speed: 0 })
    await session.connect('s1')
    ;(document as unknown as { fullscreenElement: Element | null }).fullscreenElement = document.documentElement
    render(
      <LiveSessionProvider sessionId="s1" session={session}>
        <Probe />
        <div className="fixed inset-0"><LiveInterviewInner sessionId="s1" /></div>
      </LiveSessionProvider>,
    )
    act(() => {
      live!.send({ type: 'START_CHECKS' })
      live!.send({ type: 'CHECKS_PASSED' })
      live!.send({ type: 'CONNECTED' })
    })

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Problem 1' })).toBeInTheDocument())
    await waitFor(() => expect(document.querySelector('mark[data-author="interviewer"]')).not.toBeNull())
    expect(screen.getByText(/the problem is on your screen/i)).toBeInTheDocument()
    // The editor is stubbed here, so the scripted comment is refused and the refusal is acknowledged.
    await waitFor(() => expect(session.sentOf('ack').some((a) => !a.ok && a.reason === 'editor_not_ready')).toBe(true))

    await userEvent.click(screen.getByRole('button', { name: 'End interview' }))
    await userEvent.click(screen.getAllByRole('button', { name: 'End interview' }).at(-1)!)
    await waitFor(() => expect(screen.getByRole('heading', { name: 'You ended the interview' })).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && pnpm vitest run features/interview-live/session/ScriptedRoom.test.tsx`
Expected: FAIL — `ScriptedLiveSession` and `LiveInterviewInner` export missing.

- [ ] **Step 3: Write `script.ts`**

```ts
/**
 * The canned interview ScriptedLiveSession plays (local development and tests). A made-up demo
 * problem, not one from the bank. It exercises every workspace message the real interviewer uses.
 */
import type { AgentMessageBody, WebMessage } from '../protocol/messages'
import type { AgentState } from './types'

export type Step = { after: number } & ({ say: string } | { message: AgentMessageBody } | { state: AgentState } | { disconnect: true })

export const DEMO_ITEM = 'demo-1'
const STATEMENT =
  'Given a string s, return the length of the longest substring that contains at most two distinct characters. ' +
  'There is exactly one answer for every input.'

export const OPENING: Step[] = [
  { after: 600, say: "Hi, I'm Asha. Thanks for joining today. This is a mock coding round, so think out loud and ask me anything that's unclear." },
  {
    after: 2500,
    message: {
      type: 'panel.show_problem', item_id: DEMO_ITEM, label: 'Problem 1', kind: 'problem', statement: STATEMENT,
      examples: [
        { input: 's = "eceba"', output: '3', explanation: 'The substring is "ece".' },
        { input: 's = "ccaabbb"', output: '5', explanation: 'The substring is "aabbb".' },
      ],
    },
  },
  { after: 300, say: "The problem is on your screen. Take a minute to read it, and tell me how you'd approach it." },
  { after: 6000, message: { type: 'panel.highlight', item_id: DEMO_ITEM, highlight_id: 'demo-hl-1', quote: 'at most two distinct characters', note: 'The key condition.' } },
  { after: 400, say: 'Notice the condition I highlighted: at most two distinct characters.' },
  { after: 5000, message: { type: 'code.comment', at: 'top', text: "What's the time complexity of your current approach?", purpose: 'question' } },
  { after: 300, say: "I've left a question at the top of your editor." },
  {
    after: 6000,
    message: {
      type: 'board.draw',
      elements: [
        { type: 'rectangle', id: 'demo-in', label: 'input s' },
        { type: 'rectangle', id: 'demo-fn', label: 'your function' },
        { type: 'rectangle', id: 'demo-out', label: 'length' },
        { type: 'arrow', id: 'demo-a1', from: 'demo-in', to: 'demo-fn' },
        { type: 'arrow', id: 'demo-a2', from: 'demo-fn', to: 'demo-out' },
      ],
    },
  },
  { after: 300, say: "I've sketched the shape of it on the whiteboard, if that helps." },
]

const short = (q: string) => (q.length > 60 ? `${q.slice(0, 57)}…` : q)

export function askReply(quote: string, itemId: string = DEMO_ITEM): Step[] {
  return [
    { after: 700, say: `Good question about "${short(quote)}".` },
    {
      after: 300,
      message: {
        type: 'panel.add_section', item_id: itemId,
        section: { id: `demo-clar-${Date.now()}`, kind: 'clarification', title: 'Clarification', body: 'Characters are case-sensitive, and the string may be empty.', author: 'interviewer' },
      },
    },
    { after: 200, say: "I've added that to the problem." },
  ]
}

const MENTION: Record<Extract<WebMessage, { type: 'proctor.event' }>['kind'], string> = {
  tab_hidden: 'I noticed you switched tabs. Please stay on this screen.',
  window_blur: 'I noticed you moved to another window. Please stay on this screen.',
  external_display: 'I can see a second display. Please disconnect it.',
  fullscreen_exit: "You've left full screen. Please go back to it.",
  share_stopped: 'Your screen share stopped. Please share your entire screen again.',
}

/** Mirrors the spec §7 rule: mention every event; the 2nd full violation gets a final warning; the 3rd ends the round. */
export function proctorReply(event: Extract<WebMessage, { type: 'proctor.event' }>): Step[] {
  if (event.weight !== 1) return [{ after: 400, say: MENTION[event.kind] }]
  if (event.counts.full_violations >= 3) {
    return [
      { after: 400, say: "That's the third time. I'm ending the interview here because of repeated screen switching." },
      { after: 300, message: { type: 'session.ending', reason: 'ended_by_interviewer', message: "I'm ending the interview here because of repeated screen switching." } },
      { after: 300, disconnect: true },
    ]
  }
  if (event.counts.full_violations === 2) {
    return [{ after: 400, say: `${MENTION[event.kind]} This is your final warning: one more and I'll end the interview.` }]
  }
  return [{ after: 400, say: MENTION[event.kind] }]
}

export const GOODBYE: Step[] = [
  { after: 500, say: 'Thanks for your time today. Take care.' },
  { after: 300, message: { type: 'session.ending', reason: 'candidate_ended', message: 'You ended the interview.' } },
  { after: 300, disconnect: true },
]
```

- [ ] **Step 4: Write `ScriptedLiveSession.ts`**

```ts
import { newMessageId, stampAgent, type WebMessage } from '../protocol/messages'
import { MockLiveSession } from './MockLiveSession'
import { GOODBYE, OPENING, askReply, proctorReply, type Step } from './script'

/** A scripted interviewer over MockLiveSession: it waits for the room's `workspace.hello` (as the real
 * agent does), plays OPENING, and reacts to Ask selections, proctoring events and End. `speed` scales
 * every delay (1 = real time, 0 = immediately, for tests). */
export class ScriptedLiveSession extends MockLiveSession {
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()
  private started = false

  constructor(private readonly options: { speed?: number } = {}) {
    super()
  }

  override async disconnect(): Promise<void> {
    this.timers.forEach(clearTimeout)
    this.timers.clear()
    await super.disconnect()
  }

  protected override handleSent(m: WebMessage): void {
    switch (m.type) {
      case 'workspace.hello':
        if (!this.started) {
          this.started = true
          this.play(OPENING)
        }
        break
      case 'ask.selection':
        this.play(askReply(m.quote, m.item_id))
        break
      case 'proctor.event':
        this.play(proctorReply(m))
        break
      case 'session.end_request':
        this.play(GOODBYE)
        break
      default:
        break
    }
  }

  private play(steps: Step[]) {
    let at = 0
    for (const step of steps) {
      at += step.after
      const t = setTimeout(() => {
        this.timers.delete(t)
        this.run(step)
      }, at * (this.options.speed ?? 1))
      this.timers.add(t)
    }
  }

  private run(step: Step) {
    if ('say' in step) this.say(step.say)
    else if ('message' in step) this.emitMessage(stampAgent(step.message))
    else if ('state' in step) this.emitAgentState(step.state)
    else void this.disconnect()
  }

  private say(text: string) {
    const id = newMessageId('seg')
    const at = Date.now()
    this.emitAgentState('speaking')
    this.emitTranscript({ id, speaker: 'interviewer', text: text.split(' ').slice(0, 4).join(' '), final: false, at })
    this.emitTranscript({ id, speaker: 'interviewer', text, final: true, at })
    this.emitAgentState('listening')
  }
}
```

- [ ] **Step 5: Write `mockMode.ts`**

```ts
/** Local development only: NEXT_PUBLIC_LIVE_MOCK=1 runs the room against the scripted interviewer,
 * with no API or LiveKit. Never on in production builds. */
export function isMockMode(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_LIVE_MOCK === '1'
}
```

- [ ] **Step 6: Export the inner room and add the mock room**

In `LiveInterview.tsx`:
- Change `function LiveInterviewInner(` to `export function LiveInterviewInner(` and make `meta` optional in its props (`{ sessionId: string; meta?: RoomMeta }` — it already is).
- Add the imports:

```tsx
import { useState } from "react";
import { ScriptedLiveSession } from "@/features/interview-live/session/ScriptedLiveSession";
```

(merge `useState` into the existing `react` import).
- Add, below `LiveInterviewInner`:

```tsx
/** Local development (`isMockMode()`): the room against the scripted interviewer, with no server gate,
 * API or LiveKit. */
export function MockRoom({ sessionId, meta }: { sessionId: string; meta?: RoomMeta }) {
  const [session] = useState(() => new ScriptedLiveSession());
  return (
    <LiveSessionProvider sessionId={sessionId} session={session}>
      <div className="fixed inset-0 z-50 flex bg-frame">
        <LiveInterviewInner sessionId={sessionId} meta={meta} />
      </div>
    </LiveSessionProvider>
  );
}
```

In `LiveRoom.tsx`, replace the body with:

```tsx
export function LiveRoom({ sessionId }: { sessionId: string }) {
  const { data } = useSession(sessionId);
  const meta = roomMetaFrom(data);
  return (
    <>
      <HudZoomOff />
      {isMockMode() ? <MockRoom sessionId={sessionId} meta={meta} /> : <LiveInterview sessionId={sessionId} meta={meta} />}
    </>
  );
}
```

with imports `import LiveInterview, { MockRoom } from "./LiveInterview";` (replacing the default-only import) and `import { isMockMode } from "@/features/interview-live/session/mockMode";`.

- [ ] **Step 7: Document the flag**

Append to `apps/web/.env.example`:

```
# Local development only: run the live interview room against a scripted mock interviewer
# (no API, LiveKit or AI service). Open /interviews/<any-id>/live while signed in.
NEXT_PUBLIC_LIVE_MOCK=0
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd apps/web && pnpm vitest run features/interview-live/session/ScriptedRoom.test.tsx`
Expected: PASS.

- [ ] **Step 9: Run the whole live-room suite, the typecheck and lint**

Run: `cd apps/web && pnpm vitest run features/interview-live "app/(app)/interviews" && pnpm typecheck && pnpm lint`
Expected: all PASS, no type or lint errors.

- [ ] **Step 10: See it in the browser**

With `NEXT_PUBLIC_LIVE_MOCK=1` in `apps/web/.env.local`, run the web app (`pnpm --filter @interviewiq/web dev`), sign in, open `/interviews/demo/live`, go through pre-join and the checks (share the entire screen), and confirm:
- the transcript shows Asha's lines as bubbles; the problem appears as "Problem 1" with two examples and no constraints;
- the highlight, the editor comment at the top (with the orange gutter mark) and the whiteboard drawing (orange, with the dot on Board while it is hidden) arrive;
- selecting statement text offers Highlight · Ask; Ask pins "Asking about" and the interviewer adds a clarification;
- switching tabs raises TAB CHANGES with the warning toast, and Asha mentions it; leaving full screen adds 0.5 and shows the return bar;
- End asks to confirm, Asha says goodbye, and the end screen reads "You ended the interview".

Report anything that differs; don't change the plan's scope to fix unrelated issues.
