import { describe, expect, it } from 'vitest'
import { ATTENTION, calibrate, lookingAway, NEW_ATTENTION, type Attention } from './attention'

const FACING = { side: 0.1, up: 0, down: 0.2 }

function calibrated(yaw = 0.02, pitch = 0.55): Attention {
  let a = NEW_ATTENTION
  for (let i = 0; i < ATTENTION.calibrationFrames; i++) a = calibrate(a, { yaw, pitch }, FACING)
  return a
}

describe('calibrate', () => {
  it('sets the baseline from the median of the first facing frames, then never moves it', () => {
    let a = NEW_ATTENTION
    for (let i = 0; i < ATTENTION.calibrationFrames - 1; i++) a = calibrate(a, { yaw: 0.02, pitch: 0.55 }, FACING)
    expect(a.baseline).toBeNull()
    a = calibrate(a, { yaw: 0.1, pitch: 0.9 }, FACING)
    expect(a.baseline).toEqual({ yaw: 0.02, pitch: 0.55 })
    expect(calibrate(a, { yaw: 0.1, pitch: 0.1 }, FACING).baseline).toEqual({ yaw: 0.02, pitch: 0.55 })
  })

  it('skips frames where the candidate is turned away', () => {
    let a = NEW_ATTENTION
    for (let i = 0; i < ATTENTION.calibrationFrames * 2; i++) a = calibrate(a, { yaw: 0.3, pitch: 0.5 }, FACING)
    expect(a.baseline).toBeNull()
  })
})

describe('lookingAway', () => {
  it('cannot judge before there is a baseline', () => {
    expect(lookingAway({ yaw: 0.4, pitch: 0.5 }, FACING, null)).toBeNull()
  })

  it('accepts small movements around the baseline', () => {
    const { baseline } = calibrated()
    expect(lookingAway({ yaw: 0.1, pitch: 0.6 }, FACING, baseline)).toBe(false)
  })

  it('flags a turned head, a bowed or raised head and eyes off the screen', () => {
    const { baseline } = calibrated()
    expect(lookingAway({ yaw: 0.25, pitch: 0.55 }, FACING, baseline)).toBe(true)
    expect(lookingAway({ yaw: 0.02, pitch: 0.7 }, FACING, baseline)).toBe(true)
    expect(lookingAway({ yaw: 0.02, pitch: 0.4 }, FACING, baseline)).toBe(true)
    expect(lookingAway({ yaw: 0.02, pitch: 0.55 }, { side: 0.7, up: 0, down: 0 }, baseline)).toBe(true)
    expect(lookingAway({ yaw: 0.02, pitch: 0.55 }, { side: 0, up: 0, down: 0.8 }, baseline)).toBe(true)
  })
})
