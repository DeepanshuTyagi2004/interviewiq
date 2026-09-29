/**
 * Turns Excalidraw scene elements into a readable text summary for the diagram artifact
 * sent to the interviewer. Pure — no Excalidraw import here, just a structural shape so
 * it stays testable without the (browser-only) library loaded.
 */
interface El {
  type?: string
  id?: string
  text?: string
  isDeleted?: boolean
  startBinding?: { elementId?: string }
  endBinding?: { elementId?: string }
}

export function summarizeScene(elements: readonly unknown[]): string {
  const els = (elements as El[]).filter((e) => e && e.type && !e.isDeleted)
  if (!els.length) return '(empty diagram — no shapes drawn yet)'
  const lines: string[] = []
  for (const e of els) {
    if (e.type === 'text' && e.text) lines.push(`text: "${e.text}"`)
    else if (e.type === 'arrow' || e.type === 'line')
      lines.push(`${e.type}: ${e.startBinding?.elementId ?? '?'} → ${e.endBinding?.elementId ?? '?'}`)
    else lines.push(`${e.type}${e.text ? ` "${e.text}"` : ''}${e.id ? ` [${e.id}]` : ''}`)
  }
  return lines.join('\n')
}
