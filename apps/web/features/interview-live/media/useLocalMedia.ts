'use client'
import { useCallback, useState } from 'react'
import type { LiveSession } from '../session/types'

export function useLocalMedia(session: LiveSession) {
  const [stream] = useState<MediaStream | null>(() => session.getLocalStream())
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)
  const [error] = useState<string | null>(null)
  const toggleMic = useCallback(() => { const next = !micOn; session.setMicEnabled(next); setMicOn(next) }, [micOn, session])
  const toggleCam = useCallback(() => { const next = !camOn; session.setCameraEnabled(next); setCamOn(next) }, [camOn, session])
  return { stream, micOn, camOn, toggleMic, toggleCam, error }
}
