'use client'
import { useCallback, useState } from 'react'
import type { LiveSession } from '../session/types'

export function useLocalMedia(session: LiveSession) {
  const [stream] = useState<MediaStream | null>(() => session.getLocalStream())
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)
  const [error] = useState<string | null>(null)
  const toggleMic = useCallback(() => setMicOn((on) => { session.setMicEnabled(!on); return !on }), [session])
  const toggleCam = useCallback(() => setCamOn((on) => { session.setCameraEnabled(!on); return !on }), [session])
  return { stream, micOn, camOn, toggleMic, toggleCam, error }
}
