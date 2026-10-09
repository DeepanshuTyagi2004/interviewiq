'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { endLive } from '@/features/interview/api'
import { stopScreenShare } from '../proctor/screenShare'
import { LiveKitLiveSession } from './LiveKitLiveSession'
import { isMockMode } from './mockMode'
import { EndReason } from '../protocol/messages'
import { initialMachine, transition, type LiveContext, type LiveEvent, type LiveState } from './machine'
import { applySegment, systemNote, type TranscriptSegment } from './transcript'
import type { AgentState, LiveSession } from './types'

/** How long End waits for the interviewer's goodbye before ending the room locally. */
export const END_FALLBACK_MS = 12_000

interface Ctx {
  session: LiveSession
  state: LiveState
  ctx: LiveContext
  send: (e: LiveEvent) => void
  transcript: TranscriptSegment[]
  agentState: AgentState
  /** Adds a centred notice to the transcript. */
  addNote: (text: string) => void
  /** The candidate confirmed End: ask the interviewer to close the round, with a local fallback. */
  requestEnd: () => void
}
const LiveCtx = createContext<Ctx | null>(null)

export function LiveSessionProvider({ sessionId, session, children }: { sessionId: string; session?: LiveSession; children: React.ReactNode }) {
  // Lazy useState (not useRef) so the stable session instance can be read during render.
  const [liveSession] = useState<LiveSession>(() => session ?? new LiveKitLiveSession())
  const [{ state, ctx }, dispatch] = useReducer(
    (s: { state: LiveState; ctx: LiveContext }, e: LiveEvent) => transition(s.state, s.ctx, e),
    undefined, initialMachine,
  )
  const [transcript, setTranscript] = useState<TranscriptSegment[]>([])
  const [agentState, setAgentState] = useState<AgentState>('absent')
  const stateRef = useRef(state)
  const endTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { stateRef.current = state }, [state])

  const send = useCallback((e: LiveEvent) => dispatch(e), [])
  const addNote = useCallback((text: string) => setTranscript((t) => applySegment(t, systemNote(text))), [])

  useEffect(() => liveSession.onMessage((m) => {
    if (m.type === 'session.ending') dispatch({ type: 'ENDED', reason: m.reason, message: m.message })
  }), [liveSession])
  useEffect(() => liveSession.onTranscript((s) => setTranscript((t) => applySegment(t, s))), [liveSession])
  useEffect(() => liveSession.onAgentState(setAgentState), [liveSession])
  /** The candidate's End, from here: record it in the API and word the ending from the answer. The API holds the truth:
   * the interviewer may have ended the round first (say, for misconduct) with its goodbye lost, and then the stored
   * reason, not "you ended it", is what the screen should say. Never called in local mock mode. */
  const endAsCandidate = useCallback(async () => {
    let reason: EndReason = 'candidate_ended'
    if (!isMockMode()) {
      try {
        const stored = EndReason.safeParse((await endLive(sessionId)).endReason)
        if (stored.success) reason = stored.data
      } catch {
        // offline: the end is the candidate's, and the interviewer's own report settles the record
      }
    }
    dispatch({ type: 'ENDED', reason })
  }, [sessionId])

  useEffect(() => liveSession.onConnectionChange((s) => {
    if (s === 'reconnecting') dispatch({ type: 'RECONNECTING' })
    else if (s === 'connected') dispatch({ type: 'RECONNECTED' })
    // The interviewer deletes the room after its goodbye: after End that is an ending we ask the API about.
    else if (s === 'disconnected') {
      if (stateRef.current === 'ending') void endAsCandidate()
      else dispatch({ type: 'ENDED', reason: 'technical' })
    }
  }), [liveSession, endAsCandidate])

  const requestEnd = useCallback(() => {
    dispatch({ type: 'END' })
    liveSession.send({ type: 'session.end_request' })
    if (endTimer.current) clearTimeout(endTimer.current)
    endTimer.current = setTimeout(() => {
      endTimer.current = null
      void endAsCandidate() // the interviewer never answered
    }, END_FALLBACK_MS)
  }, [liveSession, endAsCandidate])

  // Release media on any exit (navigation away, unmount).
  useEffect(() => () => {
    if (endTimer.current) clearTimeout(endTimer.current)
    void liveSession.disconnect()
    stopScreenShare()
  }, [liveSession])

  // Every path into `ended` (interviewer, End, a drop) releases media and leaves full screen.
  useEffect(() => {
    if (state !== 'ended') return
    if (endTimer.current) clearTimeout(endTimer.current)
    void liveSession.disconnect()
    stopScreenShare()
    if (typeof document !== 'undefined' && document.fullscreenElement) void document.exitFullscreen()
  }, [state, liveSession])

  const value = useMemo<Ctx>(
    () => ({ session: liveSession, state, ctx, send, transcript, agentState, addNote, requestEnd }),
    [liveSession, state, ctx, send, transcript, agentState, addNote, requestEnd],
  )
  return <LiveCtx.Provider value={value}>{children}</LiveCtx.Provider>
}

export function useLiveSession(): Ctx {
  const v = useContext(LiveCtx)
  if (!v) throw new Error('useLiveSession must be used within a LiveSessionProvider')
  return v
}
