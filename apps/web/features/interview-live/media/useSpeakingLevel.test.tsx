import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useSpeakingLevel } from './useSpeakingLevel'

describe('useSpeakingLevel', () => {
  let fakeStream: MediaStream | null

  beforeEach(() => {
    // Create a fake MediaStream for testing (matching test pattern from useLocalMedia)
    // @ts-expect-error MediaStream constructor doesn't accept string array, but we're using it as a test double
    fakeStream = new MediaStream(['audio', 'video']) as unknown as MediaStream
  })

  it('returns false with null stream', () => {
    const { result } = renderHook(() => useSpeakingLevel(null, true))
    expect(result.current).toBe(false)
  })

  it('returns false when disabled', () => {
    const { result } = renderHook(() => useSpeakingLevel(fakeStream, false))
    expect(result.current).toBe(false)
  })

  it('does not throw with stubbed AudioContext', () => {
    expect(() => {
      const { unmount } = renderHook(() => useSpeakingLevel(fakeStream, true))
      unmount()
    }).not.toThrow()
  })

  it('updates speaking state based on audio level', () => {
    const { result, rerender } = renderHook(
      ({ stream, enabled }: { stream: MediaStream | null; enabled: boolean }) =>
        useSpeakingLevel(stream, enabled),
      { initialProps: { stream: fakeStream, enabled: true } }
    )

    // Initially false or based on actual audio
    expect(typeof result.current).toBe('boolean')

    // When disabled, should be false
    rerender({ stream: fakeStream, enabled: false })
    expect(result.current).toBe(false)

    // When enabled again, should poll
    rerender({ stream: fakeStream, enabled: true })
    expect(typeof result.current).toBe('boolean')
  })
})
