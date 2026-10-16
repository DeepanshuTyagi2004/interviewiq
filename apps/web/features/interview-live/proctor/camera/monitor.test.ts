import { describe, expect, it } from 'vitest'
import { CLEAR_MS, monitorStatus, NEW_MONITOR, stepMonitor, SUSTAIN_MS, type CameraFrame, type Monitor } from './monitor'

const OK: CameraFrame = { faces: 1, away: false, identity: 'same' }

/** Feeds a frame every 200 ms from `from` to `to` (inclusive). */
function run(m: Monitor, frame: CameraFrame, from: number, to: number): Monitor {
  for (let t = from; t <= to; t += 200) m = stepMonitor(m, frame, t).monitor
  return m
}

describe('camera monitor', () => {
  it('is green while one facing, known person is in view', () => {
    const m = run(NEW_MONITOR, OK, 0, 10_000)
    expect(monitorStatus(m)).toEqual({ status: 'ok', reason: null })
    expect(m.flags).toEqual([])
  })

  it('turns amber at once and red with one flag once a condition lasts its threshold', () => {
    let m = run(NEW_MONITOR, OK, 0, 1000)
    m = stepMonitor(m, { ...OK, faces: 2 }, 1200).monitor
    expect(monitorStatus(m)).toEqual({ status: 'warn', reason: 'multiple_faces' })
    m = run(m, { ...OK, faces: 2 }, 1400, 1200 + SUSTAIN_MS.multiple_faces + 200)
    expect(monitorStatus(m)).toEqual({ status: 'violation', reason: 'multiple_faces' })
    expect(m.flags).toEqual([{ kind: 'multiple_faces', at: 1200 }])
  })

  it('never flags a short glance away', () => {
    let m = run(NEW_MONITOR, { ...OK, away: true }, 0, SUSTAIN_MS.looking_away - 400)
    m = run(m, OK, SUSTAIN_MS.looking_away - 200, SUSTAIN_MS.looking_away + CLEAR_MS + 400)
    expect(m.flags).toEqual([])
    expect(monitorStatus(m).status).toBe('ok')
  })

  it('counts one flag for one episode, even when the condition flickers', () => {
    let m = run(NEW_MONITOR, { ...OK, faces: 0 }, 0, 4000)
    m = stepMonitor(m, OK, 4200).monitor
    m = run(m, { ...OK, faces: 0 }, 4400, 8000)
    expect(m.flags).toHaveLength(1)
    m = run(m, OK, 8200, 8200 + CLEAR_MS + 200)
    expect(monitorStatus(m).status).toBe('ok')
    m = run(m, { ...OK, faces: 0 }, 12_000, 16_000)
    expect(m.flags.map((f) => f.kind)).toEqual(['no_face', 'no_face'])
  })

  it('flags a changed face at once (the identity check already waited) and names it first', () => {
    const m = stepMonitor(NEW_MONITOR, { faces: 1, away: true, identity: 'different' }, 0)
    expect(m.added.map((f) => f.kind)).toEqual(['face_changed'])
    expect(monitorStatus(m.monitor)).toEqual({ status: 'violation', reason: 'face_changed' })
  })

  it("doesn't judge looking away before the gaze baseline exists", () => {
    const m = run(NEW_MONITOR, { ...OK, away: null }, 0, 10_000)
    expect(monitorStatus(m).status).toBe('ok')
  })
})
