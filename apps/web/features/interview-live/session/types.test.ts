import { describe, it, expect } from 'vitest'
import type { LiveSession, ControlSignal, ProctorEvent, ArtifactSnapshot } from './types'

it('control signals + artifact + proctor event shapes compile and construct', () => {
  const c: ControlSignal = { type: 'speaking', who: 'interviewer', speaking: true }
  const a: ArtifactSnapshot = { kind: 'code', content: 'x=1', language: 'python' }
  const p: ProctorEvent = { type: 'fullscreen_exit', at: 1 }
  expect(c.type).toBe('speaking'); expect(a.kind).toBe('code'); expect(p.type).toBe('fullscreen_exit')
  const _assert: LiveSession | null = null   // interface is importable as a type
  expect(_assert).toBeNull()
})
