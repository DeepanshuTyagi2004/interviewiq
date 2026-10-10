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
/** What the room should look like: `talk` is the conversation full width (greetings, resume and profile questions,
 * the closing), `work` is the conversation beside the problem and editor. `slow` says the interviewer is taking
 * longer than usual to answer. The agent sends the whole state on every change and again after a `workspace.hello`. */
export const RoomLayout = z.enum(['talk', 'work'])
export const RoomState = z.object({ ...header, type: z.literal('room.state'), layout: RoomLayout, slow: z.boolean() })
export const SessionEnding = z.object({ ...header, type: z.literal('session.ending'), reason: EndReason, message: z.string().max(1000) })

export const AgentMessage = z.discriminatedUnion('type', [
  ShowProblem, AddSection, PanelHighlight, PanelClearHighlight, CodeComment, CodeInsert, CodeHighlight,
  CodeClearHighlight, BoardRequestSnapshot, BoardDraw, WorkspaceRestore, RoomState, SessionEnding,
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
  k: z.literal('shape'), t: At, op: z.enum(['add', 'move', 'edit', 'delete']), id: Id, kind: z.string().regex(/^[a-z]+$/).max(30), label: z.string().max(60).optional(),
})
const Focus = z.object({ k: z.literal('focus'), t: At, s: z.enum(['code', 'board', 'panel']) })
/** One thing the candidate did in the workspace; `t` is browser epoch milliseconds. */
export const ActivityEvent = z.union([PtrCode, PtrBoard, PtrPanel, PtrOut, Caret, Edit, Shape, Focus])
export const ActivityBatch = z.object({
  ...header, type: z.literal('activity.batch'), sent_at: At, events: z.array(ActivityEvent).min(1).max(ACTIVITY_MAX_EVENTS),
})

export const WebMessage = z.discriminatedUnion('type', [
  Ack, SectionAdded, HighlightAdded, CodeHighlightAdded, AskSelection, CodeSnapshot, BoardSummary,
  ProctorEventMessage, Hello, EndRequest, ActivityBatch,
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
export type ActivityEvent = z.infer<typeof ActivityEvent>

export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
/** A message before `v` and `id` are stamped. */
export type AgentMessageBody = DistributiveOmit<AgentMessage, 'v' | 'id'>
export type WebMessageBody = DistributiveOmit<WebMessage, 'v' | 'id'>
/** An activity event before the batcher stamps `t`. */
export type ActivityEventBody = DistributiveOmit<ActivityEvent, 't'>
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
