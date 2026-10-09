/**
 * The LiveSession seam: the boundary between the room UI and the live connection (LiveKit + the
 * interviewer agent). Implementations: MockLiveSession (a controllable fake, extended by
 * ScriptedLiveSession for local development) and LiveKitLiveSession.
 */
import type { AgentMessage, WebMessageBody } from '../protocol/messages'
import type { TranscriptSegment } from './transcript'

export type ConnState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

/** From LiveKit Agents' `lk.agent.state` attribute; `absent` while no interviewer is in the room. */
export type AgentState = 'absent' | 'initializing' | 'listening' | 'thinking' | 'speaking'

/** Binary payloads the browser sends: a PNG of the whiteboard, or its compressed scene backup. */
export type BytesKind = 'board.snapshot' | 'board.backup'

export interface LiveSession {
  connect(sessionId: string): Promise<void>
  disconnect(): Promise<void>
  readonly connectionState: ConnState

  getLocalStream(): MediaStream | null
  setMicEnabled(on: boolean): void
  setCameraEnabled(on: boolean): void

  /** Sends one web → agent workspace message; stamps `v` and `id` and returns the id. */
  send(body: WebMessageBody): string
  sendBytes(kind: BytesKind, data: Uint8Array, attributes?: Record<string, string>): Promise<void>

  onMessage(cb: (m: AgentMessage) => void): () => void
  /** The whiteboard scene the agent sends after `workspace.restore` with `board: true`. */
  onBoardRestore(cb: (data: Uint8Array, attributes: Record<string, string>) => void): () => void
  onTranscript(cb: (s: TranscriptSegment) => void): () => void
  onAgentState(cb: (s: AgentState) => void): () => void
  onConnectionChange(cb: (s: ConnState) => void): () => void
}
