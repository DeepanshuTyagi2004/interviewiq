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

