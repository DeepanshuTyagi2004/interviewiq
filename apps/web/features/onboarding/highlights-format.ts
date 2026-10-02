/**
 * Pure text operations behind the Highlights editor's toolbar and shortcuts. Each takes the
 * textarea's value and selection and returns the new value and selection, so they're trivial to
 * test and the component only wires them to events.
 *
 * Format (shared with the resume parser and <FormattedLines>): one line per entry; "- " bullets,
 * "1. " numbered points, two spaces per nesting level, **bold** and *italic* inline.
 */

export interface TextEdit {
  value: string;
  start: number;
  end: number;
}

const LIST_LINE = /^(\s*)([-*]|\d+[.)])\s+(.*)$/;
const INDENT = "  ";

/** [start, end) of the full lines touched by a selection. */
function lineRange(value: string, start: number, end: number): [number, number] {
  const from = value.lastIndexOf("\n", start - 1) + 1;
  const stopAt = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const nl = value.indexOf("\n", stopAt);
  return [from, nl === -1 ? value.length : nl];
}

function replaceLines(value: string, start: number, end: number, map: (lines: string[]) => string[]): TextEdit {
  const [from, to] = lineRange(value, start, end);
  const next = map(value.slice(from, to).split("\n")).join("\n");
  return { value: value.slice(0, from) + next + value.slice(to), start: from, end: from + next.length };
}

/** Wrap the selection in `token` (e.g. "**"), or unwrap it if it's already wrapped. */
export function toggleWrap(value: string, start: number, end: number, token: string): TextEdit {
  const t = token.length;
  if (start === end) {
    // Nothing selected: drop an empty pair and put the caret inside it.
    return { value: value.slice(0, start) + token + token + value.slice(end), start: start + t, end: start + t };
  }
  if (value.slice(start - t, start) === token && value.slice(end, end + t) === token) {
    return {
      value: value.slice(0, start - t) + value.slice(start, end) + value.slice(end + t),
      start: start - t,
      end: end - t,
    };
  }
  const selected = value.slice(start, end);
  if (selected.length > 2 * t && selected.startsWith(token) && selected.endsWith(token)) {
    const inner = selected.slice(t, -t);
    return { value: value.slice(0, start) + inner + value.slice(end), start, end: start + inner.length };
  }
  // Keep surrounding whitespace outside the markers ("**word** ", not "**word **").
  const lead = selected.length - selected.trimStart().length;
  const trail = selected.length - selected.trimEnd().length;
  const core = selected.trim();
  if (!core) return { value, start, end };
  const s = start + lead;
  const e = end - trail;
  return { value: value.slice(0, s) + token + core + token + value.slice(e), start: s + t, end: e + t };
}

/** Turn the selected lines into a bullet / numbered list, or back into plain lines. */
export function toggleList(value: string, start: number, end: number, kind: "bullet" | "number"): TextEdit {
  const isKind = (line: string) => {
    const m = LIST_LINE.exec(line);
    return Boolean(m) && (kind === "number" ? /\d/.test(m![2]) : !/\d/.test(m![2]));
  };
  return replaceLines(value, start, end, (lines) => {
    const filled = lines.filter((l) => l.trim());
    const allMarked = filled.length > 0 && filled.every(isKind);
    let n = 0;
    return lines.map((line) => {
      if (!line.trim()) return line;
      const m = LIST_LINE.exec(line);
      const indent = m ? m[1] : line.slice(0, line.length - line.trimStart().length);
      const text = m ? m[3] : line.trimStart();
      if (allMarked) return indent + text;
      n += 1;
      return `${indent}${kind === "bullet" ? "-" : `${n}.`} ${text}`;
    });
  });
}

/** Indent (+1) or outdent (-1) the selected lines by one nesting level. */
export function shiftIndent(value: string, start: number, end: number, dir: 1 | -1): TextEdit {
  return replaceLines(value, start, end, (lines) =>
    lines.map((line) => {
      if (!line.trim()) return line;
      if (dir === 1) return INDENT + line;
      return line.startsWith(INDENT) ? line.slice(INDENT.length) : line.replace(/^ /, "");
    }),
  );
}

/** True when the caret's line is a list item (so Tab should nest it rather than move focus). */
export function isOnListLine(value: string, caret: number): boolean {
  const [from, to] = lineRange(value, caret, caret);
  return LIST_LINE.test(value.slice(from, to));
}

/**
 * Enter inside a list item: continue the list with the same indent and the next marker. Enter on
 * an empty item ends the list (removes its marker). Returns null when the caret isn't in a list.
 */
export function continueList(value: string, caret: number): TextEdit | null {
  const [from, to] = lineRange(value, caret, caret);
  const m = LIST_LINE.exec(value.slice(from, to));
  if (!m) return null;
  const [, indent, marker, text] = m;
  if (!text.trim()) {
    const next = value.slice(0, from) + value.slice(to);
    return { value: next, start: from, end: from };
  }
  const nextMarker = /\d/.test(marker) ? `${parseInt(marker, 10) + 1}${marker.endsWith(")") ? ")" : "."}` : marker;
  const insert = `\n${indent}${nextMarker} `;
  return { value: value.slice(0, caret) + insert + value.slice(caret), start: caret + insert.length, end: caret + insert.length };
}
