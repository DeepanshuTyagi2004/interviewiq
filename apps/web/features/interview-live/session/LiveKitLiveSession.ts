import { ConnectionState, Room, RoomEvent } from 'livekit-client'
import { goLive } from '@/features/interview/api'
import type { ArtifactSnapshot, ConnState, ControlSignal, LiveSession, ProctorEvent } from './types'

type Cb<T> = (v: T) => void

function mapConnState(s: ConnectionState): ConnState {
  switch (s) {
    case ConnectionState.Connecting:
      return 'connecting'
    case ConnectionState.Connected:
      return 'connected'
    case ConnectionState.Reconnecting:
    case ConnectionState.SignalReconnecting:
      return 'reconnecting'
    case ConnectionState.Disconnected:
    default:
      return 'disconnected'
  }
}

function isControlSignal(v: unknown): v is ControlSignal {
  return typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string'
}

/** Real LiveSession backed by a LiveKit room. Sub-project A scope: connect + data-channel
 * control bridge + artifact/proctor publishing + a local self-view stream. Mic publish to the
 * room, AI audio playback, and STT/TTS are sub-project D — not built here. */
export class LiveKitLiveSession implements LiveSession {
  connectionState: ConnState = 'idle'
  private room: Room | null = null
  private stream: MediaStream | null = null
  private controlCbs = new Set<Cb<ControlSignal>>()
  private connCbs = new Set<Cb<ConnState>>()

  async connect(sessionId: string): Promise<void> {
    this.setConn('connecting')

    // Everything that can fail before the room is actually connected — including the goLive
    // await itself — is wrapped here so ANY failure resets connectionState back to
    // 'disconnected' (via the notifying setConn) and rethrows, rather than leaving a caller
    // stuck reading 'connecting' forever after a rejected/failed connect().
    try {
      const { livekitUrl, token } = await goLive(sessionId)
      if (!livekitUrl || !token) {
        throw new Error('goLive did not return a livekitUrl/token')
      }

      const room = new Room()
      room.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
        try {
          const parsed: unknown = JSON.parse(new TextDecoder().decode(payload))
          if (isControlSignal(parsed)) this.emit(parsed)
        } catch {
          // malformed inbound data — ignore, never throw
        }
      })
      room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
        this.setConn(mapConnState(state))
      })
      this.room = room

      await room.connect(livekitUrl, token)
    } catch (err) {
      this.setConn('disconnected')
      throw err
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
    } catch {
      this.stream = null // media denied — self-view is best-effort only
    }

    // Only force 'connected' if nothing truer arrived while we were awaiting getUserMedia — a
    // RoomEvent.ConnectionStateChanged (e.g. a drop to 'disconnected' or a 'reconnecting' blip)
    // during that window already reflects reality via setConn and must not be clobbered here.
    if (this.connectionState === 'connecting') {
      this.setConn('connected')
    }
  }

  async disconnect(): Promise<void> {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    await this.room?.disconnect()
    this.setConn('disconnected')
  }

  getLocalStream() { return this.stream }

  setMicEnabled(on: boolean) { this.stream?.getAudioTracks().forEach((t) => (t.enabled = on)) }

  setCameraEnabled(on: boolean) { this.stream?.getVideoTracks().forEach((t) => (t.enabled = on)) }

  sendArtifact(a: ArtifactSnapshot) {
    this.publish({ type: 'artifact', kind: a.kind, content: a.content, language: a.language })
  }

  sendProctorEvent(e: ProctorEvent) {
    this.publish({ type: 'proctor', event: e.type })
  }

  onControl(cb: Cb<ControlSignal>) { this.controlCbs.add(cb); return () => this.controlCbs.delete(cb) }

  onConnectionChange(cb: Cb<ConnState>) { this.connCbs.add(cb); return () => this.connCbs.delete(cb) }

  private publish(obj: Record<string, unknown>) {
    this.room?.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(obj)), { reliable: true })
  }

  private emit(c: ControlSignal) { this.controlCbs.forEach((cb) => cb(c)) }

  private setConn(s: ConnState) { this.connectionState = s; this.connCbs.forEach((cb) => cb(s)) }
}
