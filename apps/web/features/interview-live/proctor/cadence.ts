/**
 * Typing cadence (live integrity spec §6.2): how the candidate types, as counts and timing statistics for each stretch of
 * five seconds. No key identity and no character is ever kept or sent; the worker decides what the rhythm means.
 */
import type { EditVia } from '../protocol/messages'

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

  /** A change to the code: typed characters and jumps back count as typing; characters that arrived with no key in the same
   * moment (`keyed` false) and no known source are "no keys", whatever the size of each change. */
  inserted(chars: number, via: EditVia, line: number, keyed = false): void {
    if (via === 'typed') {
      this.chars += chars
      if (this.lastLine !== null && line < this.lastLine) this.jumps += 1
      this.lastLine = line
    } else if (via === 'other' && !keyed) {
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
    inserted: (chars: number, via: EditVia, line: number, keyed = false) => aggregator.inserted(chars, via, line, keyed),
    stop() {
      clearInterval(timer)
      emit()
    },
  }
}
