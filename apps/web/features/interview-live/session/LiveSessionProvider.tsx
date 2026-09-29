'use client'
import { createContext, useContext, useEffect, useMemo, useReducer, useState } from 'react'
import type { LiveSession, Speaker, TranscriptEntry } from './types'
import { LiveKitLiveSession } from './LiveKitLiveSession'
import { initialMachine, transition, type LiveContext, type LiveEvent, type LiveState } from './machine'

interface Ctx {
  session: LiveSession; state: LiveState; ctx: LiveContext; send: (e: LiveEvent) => void
  speaking: Record<Speaker, boolean>; transcript: TranscriptEntry[]
}
const LiveCtx = createContext<Ctx | null>(null)

// sessionId is part of the provider's public contract (callers pass the id they're joining); wiring it
// into session.connect() lands with sub-projects A/D, so it's unused for now.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function LiveSessionProvider({ sessionId, session, children }: { sessionId: string; session?: LiveSession; children: React.ReactNode }) {
  // Lazy useState (not useRef) so the stable session instance can be read during render without
  // tripping the react-hooks/refs rule — refs may only be read in effects/handlers, not render.
  const [liveSession] = useState<LiveSession>(() => session ?? new LiveKitLiveSession())
  const [{ state, ctx }, dispatch] = useReducer(
    (s: { state: LiveState; ctx: LiveContext }, e: LiveEvent) => transition(s.state, s.ctx, e),
    undefined, initialMachine,
  )
  const send = (e: LiveEvent) => dispatch(e)
  const [speaking, setSpeaking] = useState<Record<Speaker, boolean>>({ candidate: false, interviewer: false })
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])

  useEffect(() => {
    const off = liveSession.onControl((c) => {
      if (c.type === 'pause') send({ type: 'PAUSE', reason: c.reason })
      else if (c.type === 'resume') send({ type: 'RESUME' })
      else if (c.type === 'ended') send({ type: 'ENDED', reason: c.reason })
      else if (c.type === 'speaking') setSpeaking((prev) => ({ ...prev, [c.who]: c.speaking }))
      else if (c.type === 'interviewer_utterance') setTranscript((t) => [...t, { speaker: 'interviewer', text: c.text }])
      else if (c.type === 'candidate_utterance') setTranscript((t) => [...t, { speaker: 'candidate', text: c.text }])
      else if (c.type === 'acknowledge_violation') setTranscript((t) => [...t, { speaker: 'system', text: c.text ?? 'Please return to full screen.' }])
    })
    return off
  }, [liveSession])

  useEffect(() => {
    const off = liveSession.onConnectionChange((s) => {
      if (s === 'reconnecting') send({ type: 'RECONNECTING' })
      else if (s === 'connected') send({ type: 'RECONNECTED' })
      else if (s === 'disconnected') send({ type: 'ENDED', reason: 'aborted_technical' })
    })
    return off
  }, [liveSession])

  // Release media on ANY exit (SPA navigation away, server `ended` signal, unmount) — not just the
  // LiveView End button path. disconnect() is idempotent (bumps token, clears the opening timeout,
  // stops tracks) so re-running it after the End path already ran is safe.
  useEffect(() => () => { void liveSession.disconnect() }, [liveSession])

  // Centralized end-cleanup: fires for EVERY path that lands the machine in `ended` — the manual
  // End button, the ceiling timeout, and (critically) a server-pushed `ended` control signal, which
  // maps straight to machine `ended` above (onControl) without unmounting LiveView or the provider.
  // Without this, that path leaked the camera/mic stream and left the UI stuck in fullscreen.
  // disconnect() is idempotent, so double-running it alongside LiveView.handleEnd is harmless.
  useEffect(() => {
    if (state === 'ended') {
      void liveSession.disconnect()
      if (typeof document !== 'undefined' && document.fullscreenElement) {
        void document.exitFullscreen()
      }
    }
  }, [state, liveSession])

  const value = useMemo<Ctx>(() => ({ session: liveSession, state, ctx, send, speaking, transcript }), [liveSession, state, ctx, speaking, transcript])
  return <LiveCtx.Provider value={value}>{children}</LiveCtx.Provider>
}

export function useLiveSession(): Ctx {
  const v = useContext(LiveCtx)
  if (!v) throw new Error('useLiveSession must be used within a LiveSessionProvider')
  return v
}
