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
let roomDrag = false

/** True while a drag that began inside the page is under way: dropping it into the editor is moving room text, not foreign. */
export function roomDragActive(): boolean {
  return roomDrag
}

export function setRoomDrag(on: boolean): void {
  roomDrag = on
}

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
  roomDrag = false
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
