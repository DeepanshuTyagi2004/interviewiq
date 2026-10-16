import { describe, expect, it } from 'vitest'
import { ARCFACE_TEMPLATE, cosine, eyeGaze, headPose, normalize, similarityTransform, type Point } from './face'

/** A face mesh with only the points the geometry reads; everything else at the centre. */
function mesh(points: Record<number, Point>): Point[] {
  return Array.from({ length: 478 }, (_, i) => points[i] ?? { x: 0.5, y: 0.5 })
}

const FRONTAL = { 1: { x: 0.5, y: 0.5 }, 234: { x: 0.4, y: 0.5 }, 454: { x: 0.6, y: 0.5 }, 10: { x: 0.5, y: 0.3 }, 152: { x: 0.5, y: 0.7 } }

describe('headPose', () => {
  it('is centred for a frontal face', () => {
    const p = headPose(mesh(FRONTAL), 640, 480)
    expect(p.yaw).toBeCloseTo(0)
    expect(p.pitch).toBeCloseTo(0.5)
  })

  it('moves yaw when the nose shifts across the face, and pitch when it drops', () => {
    expect(headPose(mesh({ ...FRONTAL, 1: { x: 0.58, y: 0.5 } }), 640, 480).yaw).toBeCloseTo(0.4)
    expect(headPose(mesh({ ...FRONTAL, 1: { x: 0.5, y: 0.6 } }), 640, 480).pitch).toBeCloseTo(0.75)
  })
})

describe('eyeGaze', () => {
  it('reads looking to one side from one eye in and the other out', () => {
    expect(eyeGaze({ eyeLookOutLeft: 0.8, eyeLookInRight: 0.6 }).side).toBeCloseTo(0.7)
    expect(eyeGaze({ eyeLookInLeft: 0.8, eyeLookOutRight: 0.6 }).side).toBeCloseTo(0.7)
    expect(eyeGaze({ eyeLookDownLeft: 0.9, eyeLookDownRight: 0.7 }).down).toBeCloseTo(0.8)
    expect(eyeGaze({})).toEqual({ side: 0, up: 0, down: 0 })
  })
})

describe('similarityTransform', () => {
  it('maps the template onto itself with the identity', () => {
    const [a, b, c, d, e, f] = similarityTransform(ARCFACE_TEMPLATE, ARCFACE_TEMPLATE)
    expect([a, b, c, d, e, f].map((v) => Number(v.toFixed(6)) + 0)).toEqual([1, 0, 0, 1, 0, 0])
  })

  it('recovers a scaled, rotated and shifted copy', () => {
    const angle = 0.3
    const scale = 2.5
    const src = ARCFACE_TEMPLATE.map((p) => ({
      x: scale * (Math.cos(angle) * p.x - Math.sin(angle) * p.y) + 100,
      y: scale * (Math.sin(angle) * p.x + Math.cos(angle) * p.y) + 40,
    }))
    const [a, b, c, d, e, f] = similarityTransform(src, ARCFACE_TEMPLATE)
    for (let i = 0; i < src.length; i++) {
      const s = src[i]
      expect(a * s.x + c * s.y + e).toBeCloseTo(ARCFACE_TEMPLATE[i].x, 4)
      expect(b * s.x + d * s.y + f).toBeCloseTo(ARCFACE_TEMPLATE[i].y, 4)
    }
  })
})

describe('cosine', () => {
  it('is 1 for the same direction, 0 for orthogonal and safe for zeros', () => {
    expect(cosine(new Float32Array([1, 2]), new Float32Array([2, 4]))).toBeCloseTo(1)
    expect(cosine(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0)
    expect(cosine(new Float32Array([0, 0]), new Float32Array([1, 1]))).toBe(0)
    expect(Array.from(normalize(new Float32Array([3, 4])))).toEqual([expect.closeTo(0.6), expect.closeTo(0.8)])
  })
})
