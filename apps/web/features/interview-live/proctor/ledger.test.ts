import { describe, expect, it } from 'vitest'
import { EMPTY_LEDGER, MERGE_WINDOW_MS, formatWeighted, recordEvent, type Ledger } from './ledger'
import type { ProctorKind } from '../protocol/messages'

function play(events: [ProctorKind, number][]): { ledger: Ledger; changes: string[] } {
  let ledger = EMPTY_LEDGER
  const changes: string[] = []
  for (const [kind, at] of events) {
    const r = recordEvent(ledger, kind, at)
    ledger = r.ledger
    changes.push(r.change.kind)
  }
  return { ledger, changes }
}

describe('recordEvent', () => {
  it('counts one tab switch once, even when it also blurs the window and drops full screen', () => {
    const { ledger, changes } = play([['window_blur', 1000], ['tab_hidden', 1020], ['fullscreen_exit', 1040]])
    expect(changes).toEqual(['added', 'upgraded', 'merged'])
    expect(ledger.entries).toEqual([{ kind: 'tab_hidden', weight: 1, at: 1000 }])
    expect(ledger).toMatchObject({ tabChanges: 1, screenChanges: 0, fullViolations: 1 })
  })

  it('counts separate actions separately', () => {
    const { ledger } = play([['tab_hidden', 0], ['tab_hidden', MERGE_WINDOW_MS + 1]])
    expect(ledger.tabChanges).toBe(2)
  })

  it('weights leaving full screen and stopping the share at one half, never as full violations', () => {
    const { ledger } = play([['fullscreen_exit', 0], ['share_stopped', 5000]])
    expect(ledger).toMatchObject({ tabChanges: 0, screenChanges: 1, fullViolations: 0 })
  })

  it('counts window and display changes as full screen changes', () => {
    const { ledger } = play([['window_blur', 0], ['external_display', 5000], ['fullscreen_exit', 9000]])
    expect(ledger).toMatchObject({ screenChanges: 2.5, fullViolations: 2 })
  })
})

describe('formatWeighted', () => {
  it('pads whole numbers like the HUD and keeps halves', () => {
    expect(formatWeighted(0)).toBe('00')
    expect(formatWeighted(2)).toBe('02')
    expect(formatWeighted(0.5)).toBe('0.5')
    expect(formatWeighted(1.5)).toBe('1.5')
  })
})
