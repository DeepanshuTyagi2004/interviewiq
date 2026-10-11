import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  on: {} as Record<string, (...a: unknown[]) => void>,
  text: {} as Record<string, (reader: unknown, participant: { identity: string }) => unknown>,
  bytes: {} as Record<string, (reader: unknown, participant: { identity: string }) => unknown>,
  writer: { write: vi.fn(async () => {}), close: vi.fn(async () => {}) },
  agentHere: true,
}))
const sendText = vi.fn(async () => ({}))
const streamBytes = vi.fn(async () => h.writer)
const connect = vi.fn(async () => {})

vi.mock('livekit-client', () => ({
  Room: class {
    localParticipant = {
      identity: 'cand',
      trackPublications: new Map([['mic', { trackSid: 'TR_cand' }]]),
      sendText, streamBytes,
      setMicrophoneEnabled: vi.fn(async () => {}),
    }
    get remoteParticipants() { return new Map(h.agentHere ? [['agent-1', { isAgent: true, attributes: {} }]] : []) }
    on(event: string, cb: (...a: unknown[]) => void) { h.on[event] = cb; return this }
    registerTextStreamHandler(topic: string, cb: (r: unknown, p: { identity: string }) => unknown) { h.text[topic] = cb }
    registerByteStreamHandler(topic: string, cb: (r: unknown, p: { identity: string }) => unknown) { h.bytes[topic] = cb }
    connect = connect
    disconnect = vi.fn(async () => {})
    startAudio = vi.fn(async () => {})
  },
  RoomEvent: {
    ConnectionStateChanged: 'connectionStateChanged', TrackSubscribed: 'trackSubscribed',
    ParticipantConnected: 'participantConnected', ParticipantDisconnected: 'participantDisconnected',
    ParticipantAttributesChanged: 'participantAttributesChanged',
  },
  ConnectionState: { Connecting: 'connecting', Connected: 'connected', Reconnecting: 'reconnecting', SignalReconnecting: 'signalReconnecting', Disconnected: 'disconnected' },
  Track: { Kind: { Audio: 'audio', Video: 'video' } },
}))
vi.mock('@/features/interview/api', () => ({
  goLive: vi.fn(async () => ({ livekitUrl: 'wss://x', token: 'jwt', roomName: 'interview-s1', status: 'LIVE_IN_PROGRESS' })),
}))

import { AGENT_WAIT_MS, LiveKitLiveSession } from './LiveKitLiveSession'
import type { TranscriptSegment } from './transcript'

function reader(chunks: string[], attributes: Record<string, string> = {}) {
  return {
    info: { id: 'stream-1', attributes },
    readAll: async () => chunks.join(''),
    async *[Symbol.asyncIterator]() { for (const c of chunks) yield c },
  }
}

describe('LiveKitLiveSession', () => {
  beforeEach(() => {
    for (const k of Object.keys(h.on)) delete h.on[k]
    vi.clearAllMocks()
    h.agentHere = true
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('connects and reports connected', async () => {
    const s = new LiveKitLiveSession()
    await s.connect('s1')
    expect(connect).toHaveBeenCalledWith('wss://x', 'jwt')
    expect(s.connectionState).toBe('connected')
  })

  it('delivers valid workspace messages and drops anything else', async () => {
    const s = new LiveKitLiveSession()
    const got: string[] = []
    s.onMessage((m) => got.push(m.type))
    await s.connect('s1')
    await h.text['workspace'](reader([JSON.stringify({ v: 1, id: 'a1', type: 'panel.clear_highlight', highlight_id: 'h' })]), { identity: 'agent' })
    await h.text['workspace'](reader(['{not json']), { identity: 'agent' })
    await h.text['workspace'](reader([JSON.stringify({ v: 9, id: 'a2', type: 'panel.clear_highlight', highlight_id: 'h' })]), { identity: 'agent' })
    expect(got).toEqual(['panel.clear_highlight'])
  })

  it('turns transcription streams into segments for each speaker', async () => {
    const s = new LiveKitLiveSession()
    const segs: TranscriptSegment[] = []
    s.onTranscript((x) => segs.push(x))
    await s.connect('s1')
    await h.text['lk.transcription'](reader(['Hel', 'Hello'], { 'lk.segment_id': 'seg-a' }), { identity: 'agent' })
    await h.text['lk.transcription'](reader(['I think'], { 'lk.segment_id': 'seg-b', 'lk.transcribed_track_id': 'TR_cand', 'lk.transcription_final': 'false' }), { identity: 'agent' })
    const last = (id: string) => segs.filter((x) => x.id === id).at(-1)
    expect(last('seg-a')).toMatchObject({ speaker: 'interviewer', text: 'Hello', final: true })
    expect(last('seg-b')).toMatchObject({ speaker: 'candidate', text: 'I think', final: false })
  })

  it('reports the agent state from its participant attribute', async () => {
    const s = new LiveKitLiveSession()
    const states: string[] = []
    s.onAgentState((a) => states.push(a))
    await s.connect('s1')
    h.on['participantAttributesChanged']({}, { isAgent: true, attributes: { 'lk.agent.state': 'thinking' } })
    h.on['participantDisconnected']({ isAgent: true, attributes: {} })
    expect(states).toEqual(['initializing', 'thinking', 'absent']) // the interviewer already in the room at connect is reported first
  })

  it('sends stamped messages on the workspace topic and bytes in chunks', async () => {
    const s = new LiveKitLiveSession()
    await s.connect('s1')
    s.send({ type: 'workspace.hello', has_content: false })
    const [text, opts] = sendText.mock.calls[0] as unknown as [string, { topic: string }]
    expect(opts.topic).toBe('workspace')
    expect(JSON.parse(text)).toMatchObject({ v: 1, type: 'workspace.hello' })
    await s.sendBytes('board.snapshot', new Uint8Array(20_000), { request_id: 'r1' })
    expect(streamBytes).toHaveBeenCalledWith(expect.objectContaining({ topic: 'workspace.board.snapshot', attributes: { request_id: 'r1' } }))
    expect(h.writer.write).toHaveBeenCalledTimes(2)
    expect(h.writer.close).toHaveBeenCalled()
  })

  it('does not finish connecting until the interviewer joins the room', async () => {
    vi.useFakeTimers()
    h.agentHere = false
    const s = new LiveKitLiveSession()
    let settled = false
    const connecting = s.connect('s1').then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(settled).toBe(false) // the page is held on "joining" by connect() not resolving
    h.on['participantConnected']({ isAgent: true, attributes: {} })
    await connecting
    expect(settled).toBe(true)
    expect(s.connectionState).toBe('connected')
  })

  it('gives up waiting after AGENT_WAIT_MS and enters the room anyway', async () => {
    vi.useFakeTimers()
    h.agentHere = false
    const s = new LiveKitLiveSession()
    let settled = false
    const connecting = s.connect('s1').then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(AGENT_WAIT_MS - 1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    await connecting
    expect(settled).toBe(true)
    expect(s.connectionState).toBe('connected')
  })
})
