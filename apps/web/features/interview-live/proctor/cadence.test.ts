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
