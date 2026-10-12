import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

// __dirname, not import.meta.url: under vitest the latter is a Vite /@fs/ URL, not a file path.
const contracts = (name: string) => resolve(__dirname, '../../../../../packages/contracts', name)
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
    expect(bad([{ k: 'shape', t: 1, op: 'add', id: 'a', kind: 'Rect\nangle' }])).toBe(false)   // a kind is a plain lowercase element type
    expect(bad([{ k: 'shape', t: 1, op: 'add', id: 'a', kind: 'rectangle' }])).toBe(true)
    expect(bad([out])).toBe(true)
  })

  it('stamps the version and a fresh id', () => {
    const a = stampWeb({ type: 'session.end_request' })
    const b = stampWeb({ type: 'session.end_request' })
    expect(a.v).toBe(1)
    expect(a.id).not.toBe(b.id)
    expect(stampAgent({ type: 'panel.clear_highlight', highlight_id: 'h' }).id).toMatch(/^a_/)
  })

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
})
