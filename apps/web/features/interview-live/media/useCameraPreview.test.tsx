import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useCameraPreview } from './useCameraPreview'

describe('useCameraPreview', () => {
  it('acquires its own camera+mic stream on mount', async () => {
    const { result } = renderHook(() => useCameraPreview())
    expect(result.current.stream).toBeNull()
    await waitFor(() => expect(result.current.stream).not.toBeNull())
    expect(result.current.micOn).toBe(true)
    expect(result.current.camOn).toBe(true)
  })

  it('stops all tracks on unmount', async () => {
    const { result, unmount } = renderHook(() => useCameraPreview())
    await waitFor(() => expect(result.current.stream).not.toBeNull())
    const stopSpies = result.current.stream!.getTracks().map((t) => vi.spyOn(t, 'stop'))
    unmount()
    stopSpies.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1))
  })

  it('toggles the audio track when setMicOn(false) is called', async () => {
    const { result } = renderHook(() => useCameraPreview())
    await waitFor(() => expect(result.current.stream).not.toBeNull())
    act(() => result.current.setMicOn(false))
    expect(result.current.micOn).toBe(false)
    expect(result.current.stream!.getAudioTracks()[0]!.enabled).toBe(false)
  })

  it('toggles the video track when setCamOn(false) is called', async () => {
    const { result } = renderHook(() => useCameraPreview())
    await waitFor(() => expect(result.current.stream).not.toBeNull())
    act(() => result.current.setCamOn(false))
    expect(result.current.camOn).toBe(false)
    expect(result.current.stream!.getVideoTracks()[0]!.enabled).toBe(false)
  })
})
