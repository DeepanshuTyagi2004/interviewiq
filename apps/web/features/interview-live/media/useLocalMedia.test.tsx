import { it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useLocalMedia } from './useLocalMedia'
import type { LiveSession } from '../session/types'

function fakeSession(): LiveSession {
  return {
    connect: vi.fn(), disconnect: vi.fn(), connectionState: 'connected',
    // @ts-expect-error MediaStream constructor doesn't accept string array, but we're using it as a test double
    getLocalStream: () => new MediaStream(['audio', 'video']) as unknown as MediaStream,
    setMicEnabled: vi.fn(), setCameraEnabled: vi.fn(),
    send: () => 'm1', sendBytes: async () => {}, onMessage: () => () => {}, onBoardRestore: () => () => {},
    onTranscript: () => () => {}, onAgentState: () => () => {}, onConnectionChange: () => () => {},
  }
}
it('toggles mic/cam and calls the session', () => {
  const s = fakeSession()
  const { result } = renderHook(() => useLocalMedia(s))
  expect(result.current.micOn).toBe(true)
  act(() => result.current.toggleMic())
  expect(result.current.micOn).toBe(false)
  expect(s.setMicEnabled).toHaveBeenCalledWith(false)
})
