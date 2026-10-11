import { ConnectionState, Room, RoomEvent, Track } from 'livekit-client'
import type { Participant, RemoteTrack } from 'livekit-client'
import { goLive } from '@/features/interview/api'
import { BYTE_TOPICS, WORKSPACE_TOPIC, parseAgentMessage, stampWeb, type AgentMessage, type WebMessageBody } from '../protocol/messages'
import type { TranscriptSegment } from './transcript'
import type { AgentState, BytesKind, ConnState, LiveSession } from './types'

type Cb<T> = (v: T) => void
// The readers' types, taken from the handler signatures so they track the installed SDK.
type TextStreamReader = Parameters<Parameters<Room['registerTextStreamHandler']>[1]>[0]
type ByteStreamReader = Parameters<Parameters<Room['registerByteStreamHandler']>[1]>[0]

const TRANSCRIPTION_TOPIC = 'lk.transcription'
const AGENT_STATE_ATTRIBUTE = 'lk.agent.state'
/** LiveKit's recommended byte-stream chunk size. */
const CHUNK = 15_000
const BYTES_TOPIC: Record<BytesKind, string> = {
  'board.snapshot': BYTE_TOPICS.boardSnapshot,
  'board.backup': BYTE_TOPICS.boardBackup,
}
const AGENT_STATES = new Set<AgentState>(['initializing', 'listening', 'thinking', 'speaking'])
/** How long entering waits for the interviewer to be in the room before showing the room anyway. */
export const AGENT_WAIT_MS = 15_000

function mapConnState(s: ConnectionState): ConnState {
  switch (s) {
    case ConnectionState.Connecting:
      return 'connecting'
    case ConnectionState.Connected:
      return 'connected'
    case ConnectionState.Reconnecting:
    case ConnectionState.SignalReconnecting:
      return 'reconnecting'
    default:
      return 'disconnected'
  }
}

function agentStateOf(p: Pick<Participant, 'attributes'>): AgentState {
  const v = p.attributes?.[AGENT_STATE_ATTRIBUTE] as AgentState | undefined
  return v && AGENT_STATES.has(v) ? v : 'initializing'
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0))
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.byteLength
  }
  return out
}

/** The real LiveSession: a LiveKit room. Workspace messages travel on the `workspace` text-stream
 * topic, images and scenes on byte streams; transcripts and the interviewer's state come from
 * LiveKit Agents (`lk.transcription`, `lk.agent.state`). */
export class LiveKitLiveSession implements LiveSession {
  connectionState: ConnState = 'idle'
  private room: Room | null = null
  private stream: MediaStream | null = null
  private audioTracks: RemoteTrack[] = []
  private audioEls: HTMLMediaElement[] = []
  private readonly messageCbs = new Set<Cb<AgentMessage>>()
  private readonly restoreCbs = new Set<(data: Uint8Array, attributes: Record<string, string>) => void>()
  private readonly transcriptCbs = new Set<Cb<TranscriptSegment>>()
  private readonly agentCbs = new Set<Cb<AgentState>>()
  private readonly connCbs = new Set<Cb<ConnState>>()
  private agentJoined: (() => void) | null = null

  async connect(sessionId: string): Promise<void> {
    this.setConn('connecting')
    try {
      const { livekitUrl, token } = await goLive(sessionId)
      if (!livekitUrl || !token) throw new Error('goLive did not return a livekitUrl/token')

      const room = new Room()
      // Handlers return their promise so a caller (and the tests) can await the whole read.
      room.registerTextStreamHandler(WORKSPACE_TOPIC, (reader) => this.readWorkspace(reader))
      room.registerTextStreamHandler(TRANSCRIPTION_TOPIC, (reader, participant) => this.readTranscription(reader, participant.identity))
      room.registerByteStreamHandler(BYTE_TOPICS.boardRestore, (reader) => this.readRestore(reader))
      room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => this.setConn(mapConnState(state)))
      room.on(RoomEvent.ParticipantConnected, (p: Participant) => {
        if (p.isAgent) {
          this.emitAgent(agentStateOf(p))
          this.agentJoined?.()
        }
      })
      room.on(RoomEvent.ParticipantDisconnected, (p: Participant) => { if (p.isAgent) this.emitAgent('absent') })
      room.on(RoomEvent.ParticipantAttributesChanged, (_changed: Record<string, string>, p: Participant) => {
        if (p.isAgent) this.emitAgent(agentStateOf(p))
      })
      room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio) {
          this.audioTracks.push(track)
          this.audioEls.push(track.attach())
        }
      })
      this.room = room

      await room.connect(livekitUrl, token)
      for (const p of room.remoteParticipants.values()) if (p.isAgent) this.emitAgent(agentStateOf(p))

      // Best-effort: a denied mic or blocked autoplay must not fail connect().
      try { await room.localParticipant.setMicrophoneEnabled(true) } catch { /* mic denied */ }
      try { await room.startAudio() } catch { /* autoplay blocked until a gesture */ }
    } catch (err) {
      this.setConn('disconnected')
      throw err
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
    } catch {
      this.stream = null // self-view is best-effort only
    }

    // An empty room reads as broken: enter once the interviewer is in it (the instructions page usually got it there already).
    await this.waitForAgent(AGENT_WAIT_MS)

    // Only force 'connected' if nothing truer arrived while getUserMedia was pending.
    if (this.connectionState === 'connecting') this.setConn('connected')
  }

  async disconnect(): Promise<void> {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.audioTracks.forEach((track) => track.detach())
    this.audioEls.forEach((el) => el.remove())
    this.audioTracks = []
    this.audioEls = []
    await this.room?.disconnect()
    this.setConn('disconnected')
  }

  /** Resolves when an interviewer is in the room, or after `ms`. It does not depend on the browser's hello, so it cannot deadlock. */
  private waitForAgent(ms: number): Promise<void> {
    const here = () => !!this.room && Array.from(this.room.remoteParticipants.values()).some((p) => p.isAgent)
    if (here()) return Promise.resolve()
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer)
        this.agentJoined = null
        resolve()
      }
      const timer = setTimeout(done, ms)
      this.agentJoined = done
    })
  }

  getLocalStream() { return this.stream }

  setMicEnabled(on: boolean) {
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = on))
    void this.room?.localParticipant.setMicrophoneEnabled(on)?.catch(() => {})
  }

  setCameraEnabled(on: boolean) { this.stream?.getVideoTracks().forEach((t) => (t.enabled = on)) }

  send(body: WebMessageBody): string {
    const m = stampWeb(body)
    const sending = this.room?.localParticipant.sendText(JSON.stringify(m), { topic: WORKSPACE_TOPIC })
    void sending?.catch(() => {})
    return m.id
  }

  async sendBytes(kind: BytesKind, data: Uint8Array, attributes: Record<string, string> = {}): Promise<void> {
    const local = this.room?.localParticipant
    if (!local) return
    const writer = await local.streamBytes({
      name: `${kind}-${Date.now()}`,
      topic: BYTES_TOPIC[kind],
      attributes,
      totalSize: data.byteLength,
      mimeType: kind === 'board.snapshot' ? 'image/png' : 'application/octet-stream',
    })
    for (let i = 0; i < data.byteLength; i += CHUNK) await writer.write(data.subarray(i, i + CHUNK))
    await writer.close()
  }

  onMessage(cb: Cb<AgentMessage>) { this.messageCbs.add(cb); return () => { this.messageCbs.delete(cb) } }
  onBoardRestore(cb: (data: Uint8Array, attributes: Record<string, string>) => void) {
    this.restoreCbs.add(cb)
    return () => { this.restoreCbs.delete(cb) }
  }
  onTranscript(cb: Cb<TranscriptSegment>) { this.transcriptCbs.add(cb); return () => { this.transcriptCbs.delete(cb) } }
  onAgentState(cb: Cb<AgentState>) { this.agentCbs.add(cb); return () => { this.agentCbs.delete(cb) } }
  onConnectionChange(cb: Cb<ConnState>) { this.connCbs.add(cb); return () => { this.connCbs.delete(cb) } }

  private async readWorkspace(reader: TextStreamReader) {
    let text: string
    try {
      text = await reader.readAll()
    } catch {
      return // the sender aborted or we reconnected mid-stream
    }
    const m = parseAgentMessage(text)
    if (m) this.messageCbs.forEach((cb) => cb(m))
  }

  private async readTranscription(reader: TextStreamReader, identity: string) {
    const attrs = reader.info.attributes ?? {}
    const id = attrs['lk.segment_id'] ?? reader.info.id
    const speaker = this.isCandidate(identity, attrs['lk.transcribed_track_id']) ? 'candidate' : 'interviewer'
    const at = Date.now()
    let text = ''
    try {
      for await (const chunk of reader) {
        // Chunks may be cumulative or deltas depending on the SDK version; handle both.
        text = chunk.startsWith(text) ? chunk : text + chunk
        this.transcriptCbs.forEach((cb) => cb({ id, speaker, text, final: false, at }))
      }
    } catch {
      return
    }
    const final = attrs['lk.transcription_final'] === 'true' || speaker === 'interviewer'
    this.transcriptCbs.forEach((cb) => cb({ id, speaker, text, final, at }))
  }

  private isCandidate(identity: string, trackSid?: string): boolean {
    const local = this.room?.localParticipant
    if (!local) return false
    if (identity === local.identity) return true
    return !!trackSid && Array.from(local.trackPublications.values()).some((p) => p.trackSid === trackSid)
  }

  private async readRestore(reader: ByteStreamReader) {
    let chunks: Uint8Array[]
    try {
      chunks = await reader.readAll()
    } catch {
      return
    }
    const data = concat(chunks)
    const attributes = reader.info.attributes ?? {}
    this.restoreCbs.forEach((cb) => cb(data, attributes))
  }

  private emitAgent(s: AgentState) { this.agentCbs.forEach((cb) => cb(s)) }

  private setConn(s: ConnState) {
    this.connectionState = s
    this.connCbs.forEach((cb) => cb(s))
  }
}
