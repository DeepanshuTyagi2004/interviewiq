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
  if (!want) return null // a blank line is no landmark: sliding to some other blank line would put the note anywhere
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
