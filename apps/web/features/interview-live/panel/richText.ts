/**
 * Light formatting for problem text (statement and the sections either side adds): `inline code`, **bold**,
 * powers as superscripts (10^5, 2^{31}, 10**9) and ≤ ≥ ≠ × for the ASCII operators. In a bound line ("1 <= n <= 105")
 * a power whose caret was lost in copying (105, -109, 231 - 1) is written back as 10⁵, -10⁹ and 2³¹ - 1.
 * Pure: each run keeps the source offsets it came from, so a selection on the formatted text maps back to the
 * statement exactly (highlights and Ask quote the source, never the formatted text).
 */

export interface Run {
  /** What is shown. */
  text: string
  /** The source characters it stands for: [start, end). Markup between runs (`, **, ^, braces) has no run. */
  start: number
  end: number
  sup?: boolean
  /** A symbol standing for a different number of source characters (≤ for <=): offsets inside it snap to its ends. */
  symbol?: boolean
  /** The code or bold span the run sits in, to draw that span as one element. */
  wrap?: { kind: 'code' | 'strong'; id: number }
}

/** Shown text matches the source character for character, so an offset inside it maps one to one. */
export function isMapped(run: Run): boolean {
  return !run.symbol && run.text.length === run.end - run.start
}

const SYMBOL: Record<string, string> = { '<=': '≤', '>=': '≥', '!=': '≠' }

// A line of bounds: two comparisons ("1 <= n <= 10^5"), or a name compared with a number ("n >= 2").
const BOUND_LINE = /(?:<=|>=|≤|≥|<|>)[^<>≤≥\n]*(?:<=|>=|≤|≥|<|>)|^\s*(?:[-*•]\s*)?[\w.[\]() ]{1,40}(?:<=|>=|≤|≥|<|>)\s*-?\d/

export function isBoundLine(line: string): boolean {
  return BOUND_LINE.test(line)
}

// Inside one plain stretch: an operator, a power with a caret or **, a × between numbers, and (bound lines only) a
// power that lost its caret: 10 then 2-9 or 10-18 (10^2 to 10^18), or 2 then 31, 32, 63 or 64.
const MATH = /(<=|>=|!=)|(?<=[\w)\]])\^(?:\{([^}\n]{1,20})\}|(-?\d+|[A-Za-z]\w*|\([^)\n]{1,20}\)))|(?<=\d)\*\*(-?\d+)|(?<=\d ?)(\*)(?=\s?\d)/g
const LOST_CARET = /(?<![\w.^])(10)(1[0-8]|[2-9])(?![\w.^])|(?<![\w.^])(2)(31|32|63|64)(?![\w.^])/g

function mathRuns(src: string, from: number, to: number, bounds: boolean, wrap: Run['wrap'], out: Run[]): void {
  const text = src.slice(from, to)
  const plain = (a: number, b: number) => {
    if (b <= a) return
    if (!bounds) {
      out.push({ text: src.slice(a, b), start: a, end: b, wrap })
      return
    }
    let pos = a
    for (const m of src.slice(a, b).matchAll(LOST_CARET)) {
      const at = a + (m.index ?? 0)
      const base = m[1] ?? m[3]
      const exp = m[2] ?? m[4]
      if (at > pos) out.push({ text: src.slice(pos, at), start: pos, end: at, wrap })
      out.push({ text: base, start: at, end: at + base.length, wrap })
      out.push({ text: exp, start: at + base.length, end: at + base.length + exp.length, sup: true, wrap })
      pos = at + m[0].length
    }
    if (pos < b) out.push({ text: src.slice(pos, b), start: pos, end: b, wrap })
  }
  let pos = from
  for (const m of text.matchAll(MATH)) {
    const at = from + (m.index ?? 0)
    plain(pos, at)
    const end = at + m[0].length
    if (m[1]) {
      out.push({ text: SYMBOL[m[1]], start: at, end, symbol: true, wrap })
    } else if (m[2] !== undefined) {
      out.push({ text: m[2], start: at + 2, end: end - 1, sup: true, wrap }) // ^{...}: the caret and braces are markup
    } else if (m[3] !== undefined || m[4] !== undefined) {
      const exp = m[3] ?? m[4]
      out.push({ text: exp, start: end - exp.length, end, sup: true, wrap })
    } else {
      out.push({ text: '×', start: at, end, wrap }) // one character for one: still maps one to one
    }
    pos = end
  }
  plain(pos, to)
}

// `code` and **bold** (a ** between digits is a power, never bold).
const SPANS = /`([^`\n]+)`|(?<![\w*])\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*(?![\w*])/g

/** The runs that show `src`, in order. */
export function formatRuns(src: string): Run[] {
  const out: Run[] = []
  let id = 0
  let lineStart = 0
  for (const line of src.split('\n')) {
    const lineEnd = lineStart + line.length
    const bounds = isBoundLine(line)
    let pos = lineStart
    for (const m of line.matchAll(SPANS)) {
      const at = lineStart + (m.index ?? 0)
      mathRuns(src, pos, at, bounds, undefined, out)
      const inner = m[1] ?? m[2]
      const marker = m[1] !== undefined ? 1 : 2
      mathRuns(src, at + marker, at + marker + inner.length, bounds, { kind: m[1] !== undefined ? 'code' : 'strong', id: id++ }, out)
      pos = at + m[0].length
    }
    mathRuns(src, pos, lineEnd, bounds, undefined, out)
    if (lineEnd < src.length) out.push({ text: '\n', start: lineEnd, end: lineEnd + 1 })
    lineStart = lineEnd + 1
  }
  return out
}

/** The runs, or the parts of them, that show source [start, end). A symbol goes with the side its start is on. */
export function runsIn(runs: Run[], start: number, end: number): Run[] {
  const out: Run[] = []
  for (const r of runs) {
    if (r.end <= start || r.start >= end) continue
    if (r.start >= start && r.end <= end) {
      out.push(r)
    } else if (isMapped(r)) {
      const a = Math.max(r.start, start)
      const b = Math.min(r.end, end)
      out.push({ ...r, text: r.text.slice(a - r.start, b - r.start), start: a, end: b })
    } else if (r.start >= start) {
      out.push(r)
    }
  }
  return out
}
