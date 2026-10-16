import { describe, expect, it } from 'vitest'
import { IDENTITY, NEW_IDENTITY, observeEmbedding, type Identity } from './identity'

const ME = new Float32Array([1, 0.1, 0])
const ME_AGAIN = new Float32Array([0.9, 0.2, 0.05])
const SOMEONE_ELSE = new Float32Array([0, 1, 0.2])

function enrolled(): Identity {
  let id = NEW_IDENTITY
  for (let i = 0; i < IDENTITY.enrollFrames; i++) id = observeEmbedding(id, ME)
  return id
}

describe('observeEmbedding', () => {
  it('stays unknown until the enrolment frames are in', () => {
    let id = NEW_IDENTITY
    for (let i = 0; i < IDENTITY.enrollFrames - 1; i++) id = observeEmbedding(id, ME)
    expect(id.verdict).toBe('unknown')
    expect(observeEmbedding(id, ME).verdict).toBe('same')
  })

  it('keeps the same person the same', () => {
    expect(observeEmbedding(enrolled(), ME_AGAIN).verdict).toBe('same')
  })

  it('needs repeated mismatches before calling it a different person', () => {
    const once = observeEmbedding(enrolled(), SOMEONE_ELSE)
    expect(once.verdict).toBe('same')
    expect(observeEmbedding(once, SOMEONE_ELSE).verdict).toBe('different')
  })

  it('one good match resets the count, and a return of the candidate clears the verdict', () => {
    const once = observeEmbedding(enrolled(), SOMEONE_ELSE)
    const back = observeEmbedding(once, ME_AGAIN)
    expect(back.misses).toBe(0)
    expect(observeEmbedding(back, SOMEONE_ELSE).verdict).toBe('same')
    const swapped = observeEmbedding(observeEmbedding(back, SOMEONE_ELSE), SOMEONE_ELSE)
    expect(swapped.verdict).toBe('different')
    expect(observeEmbedding(swapped, ME).verdict).toBe('same')
  })
})
