import type { Monaco } from '@monaco-editor/react'

// Literal hex is allowed here only: Monaco themes need hex, so the surfaces mirror the monochrome palette in globals.css and the
// syntax colours follow Geist's code palette (keywords pink, strings green, numbers blue, types and functions purple).
const LIGHT = {
  page: '#ffffff', surface: '#f7f7f6', surface2: '#f1f0ee', lineHi: '#ecebe8', select: '#d0cfca', selectIdle: '#e5e4e0', ink: '#0b0b0b', ink2: '#4e4e4e', ink3: '#6f6c67', line: '#ebebea',
  keyword: '#c41562', string: '#107d32', number: '#005ff2', type: '#7d00cc', fn: '#7d00cc', constant: '#a35200', comment: '#6f6c67',
}
const DARK = {
  page: '#0e0e0d', surface: '#161615', surface2: '#1d1c1b', lineHi: '#262523', select: '#42413d', selectIdle: '#2a2927', ink: '#f4f4f3', ink2: '#b4b2ae', ink3: '#85837e', line: '#242422',
  keyword: '#ff4d8d', string: '#62c073', number: '#52a8ff', type: '#bf7af0', fn: '#bf7af0', constant: '#ffb224', comment: '#85837e',
}

type Palette = typeof LIGHT

const hex = (c: string) => c.slice(1)

function iqTheme(base: 'vs' | 'vs-dark', p: Palette) {
  return {
    base,
    inherit: false,
    // Monarch token names across the editor's languages; a rule also colours the tokens under it ('number' covers 'number.float').
    rules: [
      { token: '', foreground: hex(p.ink) },
      { token: 'identifier', foreground: hex(p.ink) },
      { token: 'keyword', foreground: hex(p.keyword) },
      { token: 'keyword.directive', foreground: hex(p.keyword) },
      { token: 'string', foreground: hex(p.string) },
      { token: 'string.escape', foreground: hex(p.constant) },
      { token: 'regexp', foreground: hex(p.string) },
      { token: 'comment', foreground: hex(p.comment), fontStyle: 'italic' },
      { token: 'number', foreground: hex(p.number) },
      { token: 'constant', foreground: hex(p.constant) },
      { token: 'type', foreground: hex(p.type) },
      { token: 'type.identifier', foreground: hex(p.type) },
      { token: 'predefined', foreground: hex(p.fn) },
      { token: 'annotation', foreground: hex(p.constant) },
      { token: 'tag', foreground: hex(p.keyword) },
      { token: 'operator', foreground: hex(p.ink2) },
      { token: 'delimiter', foreground: hex(p.ink2) },
    ],
    colors: {
      'editor.background': p.page,
      'editor.foreground': p.ink,
      'editorLineNumber.foreground': p.ink3,
      'editorLineNumber.activeForeground': p.ink,
      'editor.selectionBackground': p.select,
      'editor.inactiveSelectionBackground': p.selectIdle,
      'editor.lineHighlightBackground': p.lineHi,
      'editor.lineHighlightBorder': p.line,
      'editorCursor.foreground': p.ink,
      'editorIndentGuide.background1': p.line,
      'editorWhitespace.foreground': p.line,
      'editorGutter.background': p.page,
      'editorWidget.background': p.surface,
      'editorWidget.border': p.line,
      'editorSuggestWidget.background': p.surface,
      'editorSuggestWidget.selectedBackground': p.surface2,
      'scrollbar.shadow': p.page,
    },
  }
}

/** Registers the `iq-light` and `iq-dark` Monaco themes (spec §5.5): monochrome surfaces, coloured syntax. Safe to call repeatedly. */
export function defineIqThemes(monaco: Monaco): void {
  monaco.editor.defineTheme('iq-light', iqTheme('vs', LIGHT))
  monaco.editor.defineTheme('iq-dark', iqTheme('vs-dark', DARK))
}
