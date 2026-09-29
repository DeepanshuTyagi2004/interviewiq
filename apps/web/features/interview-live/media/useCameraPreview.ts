'use client'
import { useCallback, useEffect, useState } from 'react'

interface CameraPreview {
  stream: MediaStream | null
  micOn: boolean
  camOn: boolean
  setMicOn: (on: boolean) => void
  setCamOn: (on: boolean) => void
  error: string | null
}

/** Acquires its own camera+mic stream for the Prejoin preview.
 *
 * LiveSession.getLocalStream() is null during prejoin — the session only acquires media later,
 * on connect() in ChecksView — so the preview can't bind to it. This hook gets its own stream via
 * getUserMedia, exposes independent mic/cam on/off state that toggles the stream's own tracks, and
 * stops all tracks on unmount (or whenever the caller unmounts the preview, e.g. leaving prejoin).
 */
export function useCameraPreview(): CameraPreview {
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [micOn, setMicOnState] = useState(true)
  const [camOn, setCamOnState] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let acquired: MediaStream | null = null
    navigator.mediaDevices
      .getUserMedia({ audio: true, video: true })
      .then((s) => {
        if (cancelled) {
          // A newer mount/unmount raced ahead of this promise — release the stream we just
          // acquired instead of resurrecting a preview nobody is showing anymore.
          s.getTracks().forEach((t) => t.stop())
          return
        }
        acquired = s
        setStream(s)
      })
      .catch(() => {
        if (!cancelled) setError('camera-unavailable')
      })
    return () => {
      cancelled = true
      acquired?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  const setMicOn = useCallback((on: boolean) => {
    stream?.getAudioTracks().forEach((t) => { t.enabled = on })
    setMicOnState(on)
  }, [stream])

  const setCamOn = useCallback((on: boolean) => {
    stream?.getVideoTracks().forEach((t) => { t.enabled = on })
    setCamOnState(on)
  }, [stream])

  return { stream, micOn, camOn, setMicOn, setCamOn, error }
}
