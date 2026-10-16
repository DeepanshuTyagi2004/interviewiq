/**
 * "The same person throughout": the first few clear, facing frames of the round enrol the candidate's
 * face embedding (128 numbers from the identity model, kept in memory only); later checks compare
 * against it. A mismatch counts only when it repeats, so one blurred or badly lit frame is not a swap.
 */
import { cosine, normalize } from './face'

export const IDENTITY = {
  /** Embeddings averaged into the baseline. */
  enrollFrames: 3,
  /** Cosine similarity at or above which it is the same person. The model's published threshold is
   * 0.363; this is lower, so lighting changes and glasses lean toward "same". */
  sameAt: 0.3,
  /** Mismatches in a row that make the verdict "different". */
  mismatchesToFlag: 2,
  /** How often a check runs once enrolled, and how often an enrolment frame is taken before. */
  checkEveryMs: 3000,
  enrollEveryMs: 700,
} as const

export type IdentityVerdict = 'unknown' | 'same' | 'different'

export interface Identity {
  enrolment: Float32Array[]
  baseline: Float32Array | null
  misses: number
  verdict: IdentityVerdict
}

export const NEW_IDENTITY: Identity = { enrolment: [], baseline: null, misses: 0, verdict: 'unknown' }

function mean(vs: Float32Array[]): Float32Array {
  const out = new Float32Array(vs[0].length)
  for (const v of vs) for (let i = 0; i < v.length; i++) out[i] += v[i] / vs.length
  return normalize(out)
}

export function observeEmbedding(id: Identity, embedding: Float32Array): Identity {
  const e = normalize(embedding)
  if (!id.baseline) {
    const enrolment = [...id.enrolment, e]
    if (enrolment.length < IDENTITY.enrollFrames) return { ...id, enrolment }
    return { enrolment: [], baseline: mean(enrolment), misses: 0, verdict: 'same' }
  }
  if (cosine(id.baseline, e) >= IDENTITY.sameAt) return { ...id, misses: 0, verdict: 'same' }
  const misses = id.misses + 1
  return { ...id, misses, verdict: misses >= IDENTITY.mismatchesToFlag ? 'different' : id.verdict }
}
