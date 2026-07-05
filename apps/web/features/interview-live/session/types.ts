/**
 * LiveSession seam types — the architectural boundary between the frontend UI
 * and the backend live-interview connection (LiveKit + voice pipeline).
 *
 * Two implementations:
 * - MockLiveSession (dev/tests, no backend)
 * - LiveKitLiveSession (stub now; real when backend A/D land)
 */

export type Speaker = 'candidate' | 'interviewer'

export type ConnState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

export interface ProctorEvent {
  type: 'fullscreen_exit' | 'fullscreen_restored' | 'tab_hidden' | 'tab_visible' | 'external_display_detected' | 'overlay_tamper'
  at: number
}

export interface ArtifactSnapshot {
  kind: 'code' | 'diagram'
  content: string
  language?: string
}

export type ControlSignal =
  | { type: 'interviewer_utterance'; text: string }
  | { type: 'candidate_utterance'; text: string }
  | { type: 'speaking'; who: Speaker; speaking: boolean }
  | { type: 'pause'; reason: string }
  | { type: 'resume' }
  | { type: 'acknowledge_violation'; text?: string }
  | { type: 'ended'; reason: string }

/** One line of the live-interview conversation, attributed to whichever party said it —
 * `system` covers proctoring notices (e.g. acknowledge_violation) so they render distinctly
 * from real interviewer speech instead of being misattributed to the interviewer. */
export interface TranscriptEntry {
  speaker: 'interviewer' | 'candidate' | 'system'
  text: string
}

export interface LiveSession {
  connect(sessionId: string): Promise<void>
  disconnect(): Promise<void>
  readonly connectionState: ConnState

  getLocalStream(): MediaStream | null
  setMicEnabled(on: boolean): void
  setCameraEnabled(on: boolean): void

  sendArtifact(a: ArtifactSnapshot): void
  sendProctorEvent(e: ProctorEvent): void

  onControl(cb: (c: ControlSignal) => void): () => void
  onConnectionChange(cb: (s: ConnState) => void): () => void
}
