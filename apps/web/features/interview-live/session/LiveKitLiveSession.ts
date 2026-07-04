import type { LiveSession } from './types'

/** Real implementation lands with sub-projects A (LiveKit rooms/token) + D (voice). Until then, unused. */
export class LiveKitLiveSession implements LiveSession {
  connectionState = 'idle' as const
  private nie(): never { throw new Error('LiveKitLiveSession not implemented — see spec sub-projects A + D') }
  connect() { return this.nie() }
  disconnect() { return this.nie() }
  getLocalStream() { return this.nie() }
  setMicEnabled() { this.nie() }
  setCameraEnabled() { this.nie() }
  sendArtifact() { this.nie() }
  sendProctorEvent() { this.nie() }
  onControl() { return this.nie() }
  onConnectionChange() { return this.nie() }
}
