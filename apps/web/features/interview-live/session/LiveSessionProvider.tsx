'use client'
import { createContext, useContext, useEffect, useMemo, useReducer, useState } from 'react'
import type { LiveSession, Speaker } from './types'
import { MockLiveSession } from './MockLiveSession'
import { initialMachine, transition, type LiveContext, type LiveEvent, type LiveState } from './machine'

interface Ctx {
  session: LiveSession; state: LiveState; ctx: LiveContext; send: (e: LiveEvent) => void
  speaking: Record<Speaker, boolean>; transcript: string[]
}
const LiveCtx = createContext<Ctx | null>(null)

// sessionId is part of the provider's public contract (callers pass the id they're joining); wiring it
// into session.connect() lands with sub-projects A/D, so it's unused for now.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function LiveSessionProvider({ sessionId, session, children }: { sessionId: string; session?: LiveSession; children: React.ReactNode }) {
  // Lazy useState (not useRef) so the stable session instance can be read during render without
  // tripping the react-hooks/refs rule — refs may only be read in effects/handlers, not render.
  const [liveSession] = useState<LiveSession>(() => session ?? new MockLiveSession())
  const [{ state, ctx }, dispatch] = useReducer(
    (s: { state: LiveState; ctx: LiveContext }, e: LiveEvent) => transition(s.state, s.ctx, e),
    undefined, initialMachine,
  )
  const send = (e: LiveEvent) => dispatch(e)
  const [speaking, setSpeaking] = useState<Record<Speaker, boolean>>({ candidate: false, interviewer: false })
  const [transcript, setTranscript] = useState<string[]>([])

  useEffect(() => {
    const off = liveSession.onControl((c) => {
      if (c.type === 'pause') send({ type: 'PAUSE', reason: c.reason })
      else if (c.type === 'resume') send({ type: 'RESUME' })
      else if (c.type === 'ended') send({ type: 'ENDED' })
      else if (c.type === 'speaking') setSpeaking((prev) => ({ ...prev, [c.who]: c.speaking }))
      else if (c.type === 'interviewer_utterance') setTranscript((t) => [...t, c.text])
    })
    return off
  }, [liveSession])

  const value = useMemo<Ctx>(() => ({ session: liveSession, state, ctx, send, speaking, transcript }), [liveSession, state, ctx, speaking, transcript])
  return <LiveCtx.Provider value={value}>{children}</LiveCtx.Provider>
}

export function useLiveSession(): Ctx {
  const v = useContext(LiveCtx)
  if (!v) throw new Error('useLiveSession must be used within a LiveSessionProvider')
  return v
}
