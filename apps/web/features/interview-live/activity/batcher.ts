/**
 * Turns the room's activity into `activity.batch` messages (spec §5.2): stamps each event, drops repeats
 * (a pointer that has not moved to a new target), merges keystrokes, throttles shape changes, and flushes
 * every 500 ms within the 60-event / 4 KB caps. Pure of React and the session: the room wires it up.
 */
import { ACTIVITY_MAX_EVENTS, type ActivityEvent, type ActivityEventBody } from '../protocol/messages'
import { capCodePoints } from './text'

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
type Caret = Extract<ActivityEvent, { k: 'caret' }>
type Shape = Extract<ActivityEvent, { k: 'shape' }>

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
  private heldCaret: Caret | null = null
  private lastCaretKey = ''
  private readonly lastShape = new Map<string, number>()
  private readonly heldShapes = new Map<string, Shape>()
  private stopped = false

  constructor(private readonly deps: BatcherDeps) {}

  record(body: ActivityEventBody): void {
    if (this.stopped) return
    const e = { ...body, t: this.deps.now() } as ActivityEvent
    if (e.k === 'ptr') this.pointer(e)
    else if (e.k === 'caret') this.heldCaret = e // only where it ends up: the editor reports one after every keystroke
    else if (e.k === 'edit') this.edit(e)
    else if (e.k === 'shape') this.shape(e)
    else this.buffer.push(e)
    this.arm()
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.heldPointer) this.emitPointer(this.heldPointer)
    if (this.heldCaret) this.emitCaret(this.heldCaret)
    for (const [key, e] of this.heldShapes) this.emitShape(key, e)
    this.heldShapes.clear()
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
    this.heldCaret = null
    this.heldShapes.clear()
  }

  /** Counterpart of `stop`, so a remount (React strict mode runs effects twice) works. */
  start(): void {
    this.stopped = false
  }

  private arm(): void {
    if (this.timer || this.stopped) return
    if (!this.buffer.length && !this.heldPointer && !this.heldCaret && !this.heldShapes.size) return
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

  private emitCaret(e: Caret): void {
    this.heldCaret = null
    const key = `${e.line}:${e.col}:${e.sel?.join('-') ?? ''}`
    if (key === this.lastCaretKey) return
    this.buffer.push(e)
    this.lastCaretKey = key
  }

  private edit(e: Extract<ActivityEvent, { k: 'edit' }>): void {
    const last = this.buffer.findLast((b) => b.k === 'edit') // the most recent edit, whatever else was reported since
    if (last?.k === 'edit' && last.from_line === e.from_line && last.to_line === e.to_line && e.t - last.t < EDIT_MERGE_MS) {
      last.ins = capCodePoints(last.ins + e.ins, MAX_INS)
      last.removed += e.removed
      last.t = e.t
      return
    }
    this.buffer.push(e)
  }

  private shape(e: Shape): void {
    const key = `${e.id}:${e.op}`
    const prev = this.lastShape.get(key)
    if (prev !== undefined && e.t - prev < SHAPE_MIN_GAP_MS) this.heldShapes.set(key, e) // too soon: only the latest is kept, and sent at the next flush
    else this.emitShape(key, e)
  }

  private emitShape(key: string, e: Shape): void {
    this.heldShapes.delete(key)
    if (this.lastShape.size >= MAX_TRACKED_SHAPES) this.lastShape.clear()
    this.lastShape.set(key, e.t)
    this.buffer.push(e)
  }
}
