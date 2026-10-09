import { stampWeb, type AgentMessage, type WebMessage, type WebMessageBody } from '../protocol/messages'
import type { TranscriptSegment } from './transcript'
import type { AgentState, BytesKind, ConnState, LiveSession } from './types'

type Cb<T> = (v: T) => void

function channel<T>() {
  const set = new Set<Cb<T>>()
  return {
    add(cb: Cb<T>) {
      set.add(cb)
      return () => { set.delete(cb) }
    },
    emit(v: T) { set.forEach((cb) => cb(v)) },
  }
}

/** A controllable fake LiveSession for tests and local development. It records what the room sends
 * (`sent`, `bytes`) and lets the caller play the agent's side (`emitMessage`, `emitTranscript`, …).
 * ScriptedLiveSession builds the scripted interviewer on top of it. */
export class MockLiveSession implements LiveSession {
  connectionState: ConnState = 'idle'
  readonly sent: WebMessage[] = []
  readonly bytes: { kind: BytesKind; data: Uint8Array; attributes: Record<string, string> }[] = []
  micEnabled = true
  private stream: MediaStream | null = null
  /** Bumped on connect/disconnect so a superseded connect() doesn't resurrect the session. */
  private token = 0
  private readonly messages = channel<AgentMessage>()
  private readonly restores = channel<{ data: Uint8Array; attributes: Record<string, string> }>()
  private readonly transcripts = channel<TranscriptSegment>()
  private readonly agentStates = channel<AgentState>()
  private readonly conns = channel<ConnState>()

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async connect(_sessionId: string): Promise<void> {
    const t = ++this.token
    this.setConn('connecting')
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
    } catch {
      stream = null
    }
    if (t !== this.token) {
      stream?.getTracks().forEach((tr) => tr.stop())
      return
    }
    this.stream = stream
    this.setConn('connected')
    this.emitAgentState('listening')
  }

  async disconnect(): Promise<void> {
    this.token++
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    if (this.connectionState !== 'disconnected') this.setConn('disconnected')
  }

  getLocalStream() { return this.stream }

  setMicEnabled(on: boolean) {
    this.micEnabled = on
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = on))
  }

  setCameraEnabled(on: boolean) { this.stream?.getVideoTracks().forEach((t) => (t.enabled = on)) }

  send(body: WebMessageBody): string {
    const m = stampWeb(body)
    this.sent.push(m)
    this.handleSent(m)
    return m.id
  }

  async sendBytes(kind: BytesKind, data: Uint8Array, attributes: Record<string, string> = {}): Promise<void> {
    this.bytes.push({ kind, data, attributes })
    this.handleBytes(kind, data, attributes)
  }

  onMessage(cb: Cb<AgentMessage>) { return this.messages.add(cb) }
  onBoardRestore(cb: (data: Uint8Array, attributes: Record<string, string>) => void) {
    return this.restores.add(({ data, attributes }) => cb(data, attributes))
  }
  onTranscript(cb: Cb<TranscriptSegment>) { return this.transcripts.add(cb) }
  onAgentState(cb: Cb<AgentState>) { return this.agentStates.add(cb) }
  onConnectionChange(cb: Cb<ConnState>) { return this.conns.add(cb) }

  // ---------------------------------------------------------------- the agent's side

  emitMessage(m: AgentMessage) { this.messages.emit(m) }
  emitBoardRestore(data: Uint8Array, attributes: Record<string, string> = {}) { this.restores.emit({ data, attributes }) }
  emitTranscript(s: TranscriptSegment) { this.transcripts.emit(s) }
  emitAgentState(s: AgentState) { this.agentStates.emit(s) }
  simulateConnection(s: ConnState) { this.setConn(s) }

  /** The messages of one type the room sent, for assertions. */
  sentOf<T extends WebMessage['type']>(type: T): Extract<WebMessage, { type: T }>[] {
    return this.sent.filter((m): m is Extract<WebMessage, { type: T }> => m.type === type)
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected handleSent(_m: WebMessage): void {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected handleBytes(_kind: BytesKind, _data: Uint8Array, _attributes: Record<string, string>): void {}

  protected setConn(s: ConnState) {
    this.connectionState = s
    this.conns.emit(s)
  }
}
