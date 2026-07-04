import type { ArtifactSnapshot, ConnState, ControlSignal, LiveSession, ProctorEvent } from './types'

type Cb<T> = (v: T) => void

/** Dev/test double for LiveSession: real getUserMedia, scripted interviewer turns, and echoes the
 * server-side pause/resume gating in response to proctor events — so the whole UI + proctoring flow
 * works with no backend. Swapped for LiveKitLiveSession when sub-projects A/D land. */
export class MockLiveSession implements LiveSession {
  connectionState: ConnState = 'idle'
  private stream: MediaStream | null = null
  private controlCbs = new Set<Cb<ControlSignal>>()
  private connCbs = new Set<Cb<ConnState>>()
  /** Bumped on every connect()/disconnect() so a stale in-flight connect() can detect it was
   * superseded and bail out instead of resurrecting a disconnected session. */
  private token = 0
  private openingTimeout: ReturnType<typeof setTimeout> | null = null

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async connect(_sessionId: string): Promise<void> {
    const t = ++this.token
    this.setConn('connecting')
    let stream: MediaStream | null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
    } catch {
      stream = null   // media denied — UI surfaces it; connection still proceeds for the mock
    }
    if (t !== this.token) {
      // disconnect() (or a newer connect()) ran while we were awaiting getUserMedia — don't
      // resurrect the session, just release the stream we just acquired.
      stream?.getTracks().forEach((tr) => tr.stop())
      return
    }
    this.stream = stream
    this.setConn('connected')
    // scripted opening
    this.emit({ type: 'interviewer_utterance', text: "Hi — thanks for joining. Let's start when you're ready." })
    this.emit({ type: 'speaking', who: 'interviewer', speaking: true })
    this.openingTimeout = setTimeout(() => this.emit({ type: 'speaking', who: 'interviewer', speaking: false }), 300)
  }

  async disconnect(): Promise<void> {
    this.token++
    if (this.openingTimeout !== null) {
      clearTimeout(this.openingTimeout)
      this.openingTimeout = null
    }
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.setConn('disconnected')
  }

  getLocalStream() { return this.stream }

  setMicEnabled(on: boolean) { this.stream?.getAudioTracks().forEach((t) => (t.enabled = on)) }

  setCameraEnabled(on: boolean) { this.stream?.getVideoTracks().forEach((t) => (t.enabled = on)) }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  sendArtifact(_a: ArtifactSnapshot) { /* no-op in mock; real seam POSTs to the agent */ }

  sendProctorEvent(e: ProctorEvent) {
    // mirror server-side gating: pause the interview on exit/hide, resume on restore/visible
    if (e.type === 'fullscreen_exit' || e.type === 'tab_hidden') {
      this.emit({ type: 'pause', reason: e.type })
      this.emit({ type: 'acknowledge_violation', text: "Let's keep the interview in full screen — I'll wait." })
    } else if (e.type === 'fullscreen_restored' || e.type === 'tab_visible') {
      this.emit({ type: 'resume' })
    }
  }

  onControl(cb: Cb<ControlSignal>) { this.controlCbs.add(cb); return () => this.controlCbs.delete(cb) }

  onConnectionChange(cb: Cb<ConnState>) { this.connCbs.add(cb); return () => this.connCbs.delete(cb) }

  private emit(c: ControlSignal) { this.controlCbs.forEach((cb) => cb(c)) }

  private setConn(s: ConnState) { this.connectionState = s; this.connCbs.forEach((cb) => cb(s)) }
}
