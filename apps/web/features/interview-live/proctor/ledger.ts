/**
 * The proctoring ledger (spec §7). One candidate action often fires several browser signals (a tab
 * switch blurs the window, hides the tab and can drop full screen); signals within MERGE_WINDOW_MS of
 * the action's first signal merge into one entry at the heaviest kind.
 */
import { padCount } from '@/components/hud/Count'
import type { ProctorKind } from '../protocol/messages'

export const WEIGHT: Record<ProctorKind, 1 | 0.5> = {
  tab_hidden: 1, window_blur: 1, external_display: 1, fullscreen_exit: 0.5, share_stopped: 0.5,
}
export const COUNTER: Record<ProctorKind, 'tab' | 'screen'> = {
  tab_hidden: 'tab', window_blur: 'screen', external_display: 'screen', fullscreen_exit: 'screen', share_stopped: 'screen',
}
/** Which kind names a merged action: a tab switch beats the window blur it also caused. */
const RANK: Record<ProctorKind, number> = {
  tab_hidden: 5, external_display: 4, window_blur: 3, share_stopped: 2, fullscreen_exit: 1,
}
export const MERGE_WINDOW_MS = 1500

export interface LedgerEntry {
  kind: ProctorKind
  weight: 1 | 0.5
  at: number
}

export interface Ledger {
  entries: LedgerEntry[]
  tabChanges: number
  /** Weighted: full-screen exits and stopped shares count one half. */
  screenChanges: number
  /** Full-weight violations; these drive the interviewer's end rule. */
  fullViolations: number
}

export type LedgerChange = { kind: 'added' } | { kind: 'upgraded' } | { kind: 'merged' }

export const EMPTY_LEDGER: Ledger = { entries: [], tabChanges: 0, screenChanges: 0, fullViolations: 0 }

function tally(entries: LedgerEntry[]): Ledger {
  let tabChanges = 0
  let screenChanges = 0
  let fullViolations = 0
  for (const e of entries) {
    if (COUNTER[e.kind] === 'tab') tabChanges += 1
    else screenChanges += e.weight
    if (e.weight === 1) fullViolations += 1
  }
  return { entries, tabChanges, screenChanges, fullViolations }
}

export function recordEvent(ledger: Ledger, kind: ProctorKind, at: number): { ledger: Ledger; change: LedgerChange } {
  const last = ledger.entries[ledger.entries.length - 1]
  if (last && at - last.at <= MERGE_WINDOW_MS) {
    if (RANK[kind] <= RANK[last.kind]) return { ledger, change: { kind: 'merged' } }
    const entries = [...ledger.entries.slice(0, -1), { kind, weight: WEIGHT[kind], at: last.at }]
    return { ledger: tally(entries), change: { kind: 'upgraded' } }
  }
  return { ledger: tally([...ledger.entries, { kind, weight: WEIGHT[kind], at }]), change: { kind: 'added' } }
}

/** "00", "02" like the HUD's counts; halves as "0.5", "1.5". */
export function formatWeighted(n: number): string {
  return Number.isInteger(n) ? padCount(n) : n.toFixed(1)
}
