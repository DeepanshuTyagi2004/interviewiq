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
