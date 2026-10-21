import type { Monaco } from '@monaco-editor/react'

// Literal hex is allowed here only: Monaco themes need hex, so these mirror the monochrome palette in globals.css.
const LIGHT = { page: '#ffffff', surface: '#f7f7f6', surface2: '#f1f0ee', lineHi: '#ecebe8', select: '#d0cfca', selectIdle: '#e5e4e0', ink: '#0b0b0b', ink2: '#4e4e4e', ink3: '#6f6c67', line: '#ebebea' }
const DARK = { page: '#0e0e0d', surface: '#161615', surface2: '#1d1c1b', lineHi: '#262523', select: '#42413d', selectIdle: '#2a2927', ink: '#f4f4f3', ink2: '#b4b2ae', ink3: '#85837e', line: '#242422' }

type Palette = typeof LIGHT

const hex = (c: string) => c.slice(1)

function iqTheme(base: 'vs' | 'vs-dark', p: Palette) {
  return {
    base,
    inherit: false,
    rules: [
      { token: '', foreground: hex(p.ink) },
      { token: 'keyword', foreground: hex(p.ink), fontStyle: 'bold' },
      { token: 'string', foreground: hex(p.ink2) },
      { token: 'comment', foreground: hex(p.ink3), fontStyle: 'italic' },
      { token: 'number', foreground: hex(p.ink) },
      { token: 'type', foreground: hex(p.ink) },
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

/** Registers the monochrome `iq-light` and `iq-dark` Monaco themes (spec §5.5). Safe to call repeatedly. */
export function defineIqThemes(monaco: Monaco): void {
  monaco.editor.defineTheme('iq-light', iqTheme('vs', LIGHT))
  monaco.editor.defineTheme('iq-dark', iqTheme('vs-dark', DARK))
}
