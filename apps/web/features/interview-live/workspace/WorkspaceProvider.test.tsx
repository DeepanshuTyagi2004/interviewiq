import { describe, expect, it, vi } from 'vitest'
import { act, render, renderHook, waitFor } from '@testing-library/react'
import { stampAgent, type AgentMessageBody } from '../protocol/messages'
import { MockLiveSession } from '../session/MockLiveSession'
import { WorkspaceProvider, useRoomState, useWorkspace, type BoardApi, type CodeApi, type RoomView } from './WorkspaceProvider'

type Ws = ReturnType<typeof useWorkspace>
const STATEMENT = 'Return the longest substring with at most two distinct characters.'
const SHOW: AgentMessageBody = { type: 'panel.show_problem', item_id: 'slot-1', label: 'Problem 1', kind: 'problem', statement: STATEMENT, examples: [] }

function mount(session = new MockLiveSession()) {
  const ref: { current: Ws | null } = { current: null }
  function Probe() {
    ref.current = useWorkspace()
    return null
  }
  render(<WorkspaceProvider session={session}><Probe /></WorkspaceProvider>)
  const agent = async (body: AgentMessageBody) => {
    const m = stampAgent(body)
    await act(async () => { session.emitMessage(m) })
    return m.id
  }
  const ackFor = (id: string) => session.sentOf('ack').find((a) => a.ref === id)
  return { session, ref, agent, ackFor }
}

describe('WorkspaceProvider', () => {
  it('says hello when the room mounts', () => {
    const { session } = mount()
    expect(session.sentOf('workspace.hello')).toEqual([expect.objectContaining({ has_content: false })])
  })

  it('says hello again whenever the interviewer joins or comes back: the first hello went out before it was there', () => {
    const { session } = mount()
    act(() => session.emitAgentState('absent'))
    expect(session.sentOf('workspace.hello')).toHaveLength(1)
    act(() => session.emitAgentState('initializing'))
    expect(session.sentOf('workspace.hello')).toHaveLength(2)
    act(() => { session.emitAgentState('listening'); session.emitAgentState('thinking') })
    expect(session.sentOf('workspace.hello')).toHaveLength(2)
    act(() => { session.emitAgentState('absent'); session.emitAgentState('listening') })
    expect(session.sentOf('workspace.hello')).toHaveLength(3)
  })

  it('applies a restored code that arrives before the editor has registered', async () => {
    const { ref, agent } = mount()
    await agent({ type: 'workspace.restore', cards: [], active_item_id: null, code: { language: 'python', text: 'x = 1\n' }, board: false })
    const code: CodeApi = { apply: vi.fn(() => ({ ok: true as const })), restore: vi.fn(), hasContent: () => false }
    act(() => ref.current!.registerCode(code))
    expect(code.restore).toHaveBeenCalledWith({ language: 'python', text: 'x = 1\n' })
    act(() => { ref.current!.registerCode(null); ref.current!.registerCode(code) })
    expect(code.restore).toHaveBeenCalledTimes(1)   // delivered once, not on every re-registration
  })

  it('shows a problem, acknowledges it and pops the panel back from a filled editor', async () => {
    const { ref, agent, ackFor } = mount()
    act(() => ref.current!.setExpanded('work'))
    const id = await agent(SHOW)
    expect(ref.current!.panel.cards.map((c) => c.label)).toEqual(['Problem 1'])
    expect(ref.current!.expanded).toBe('none')
    expect(ackFor(id)).toMatchObject({ ok: true })
  })

  it('refuses sections for unknown problems and highlights whose text is missing', async () => {
    const { agent, ackFor } = mount()
    const sec = await agent({ type: 'panel.add_section', item_id: 'nope', section: { id: 's', kind: 'hint', title: 'Hint', body: 'x', author: 'interviewer' } })
    expect(ackFor(sec)).toMatchObject({ ok: false, reason: 'unknown_item' })
    await agent(SHOW)
    const bad = await agent({ type: 'panel.highlight', item_id: 'slot-1', highlight_id: 'h1', quote: 'three distinct' })
    expect(ackFor(bad)).toMatchObject({ ok: false, reason: 'quote_not_found' })
    const good = await agent({ type: 'panel.highlight', item_id: 'slot-1', highlight_id: 'h2', quote: 'two distinct' })
    expect(ackFor(good)).toMatchObject({ ok: true })
  })

  it('routes code instructions to the editor, or refuses them before it is ready', async () => {
    const { ref, agent, ackFor } = mount()
    const early = await agent({ type: 'code.comment', at: 'top', text: 'Why?', purpose: 'question' })
    expect(ackFor(early)).toMatchObject({ ok: false, reason: 'editor_not_ready' })
    const code: CodeApi = { apply: vi.fn(() => ({ ok: false as const, reason: 'line_changed' })), restore: vi.fn(), hasContent: () => false }
    act(() => ref.current!.registerCode(code))
    const late = await agent({ type: 'code.comment', at: 'top', text: 'Why?', purpose: 'question' })
    expect(code.apply).toHaveBeenCalled()
    expect(ackFor(late)).toMatchObject({ ok: false, reason: 'line_changed' })
  })

  it('flags the whiteboard tool when the interviewer draws while it is hidden', async () => {
    const { ref, agent } = mount()
    const board: BoardApi = { draw: vi.fn(() => ({ ok: true as const })), snapshotPng: async () => null, restore: vi.fn(async () => {}), hasContent: () => false }
    act(() => ref.current!.registerBoard(board))
    await agent({ type: 'board.draw', elements: [{ type: 'rectangle', id: 'n1' }] })
    expect(ref.current!.boardAttention).toBe(true)
    act(() => ref.current!.setSurface('board'))
    expect(ref.current!.boardAttention).toBe(false)
  })

  it('answers a snapshot request with the PNG bytes', async () => {
    const { session, ref, agent, ackFor } = mount()
    const png = new Uint8Array([137, 80])
    act(() => ref.current!.registerBoard({ draw: () => ({ ok: true }), snapshotPng: async () => png, restore: async () => {}, hasContent: () => true }))
    const id = await agent({ type: 'board.request_snapshot', request_id: 'snap-1' })
    await waitFor(() => expect(ackFor(id)).toMatchObject({ ok: true }))
    expect(session.bytes[0]).toMatchObject({ kind: 'board.snapshot', data: png, attributes: { request_id: 'snap-1' } })
  })

  it('restores problems, code and a whiteboard that arrives before the board is ready', async () => {
    const { session, ref, agent } = mount()
    const code: CodeApi = { apply: () => ({ ok: true }), restore: vi.fn(), hasContent: () => false }
    act(() => ref.current!.registerCode(code))
    await agent({
      type: 'workspace.restore', active_item_id: 'slot-1', board: true,
      cards: [{ item_id: 'slot-1', label: 'Problem 1', kind: 'problem', statement: STATEMENT, examples: [], sections: [], highlights: [] }],
      code: { language: 'java', text: 'class A {}' },
    })
    act(() => session.emitBoardRestore(new Uint8Array([1]), { encoding: 'none' }))
    expect(ref.current!.panel.activeId).toBe('slot-1')
    expect(code.restore).toHaveBeenCalledWith({ language: 'java', text: 'class A {}' })
    const board: BoardApi = { draw: () => ({ ok: true }), snapshotPng: async () => null, restore: vi.fn(async () => {}), hasContent: () => false }
    act(() => ref.current!.registerBoard(board))
    expect(board.restore).toHaveBeenCalledWith(new Uint8Array([1]), { encoding: 'none' })
  })

  it('sends the candidate notes, highlights and Ask selections; the next answer clears Ask', async () => {
    const { session, ref, agent } = mount()
    await agent(SHOW)
    act(() => {
      ref.current!.addNote('slot-1', 'Sliding window?')
      ref.current!.addHighlight('slot-1', 'two distinct', 0)
      ref.current!.askAbout({ surface: 'statement', quote: 'two distinct', itemId: 'slot-1' })
    })
    expect(session.sentOf('panel.section_added')[0].section).toMatchObject({ kind: 'note', body: 'Sliding window?', author: 'candidate' })
    expect(session.sentOf('panel.highlight_added')[0]).toMatchObject({ quote: 'two distinct', occurrence: 0 })
    expect(session.sentOf('ask.selection')[0]).toMatchObject({ surface: 'statement', quote: 'two distinct', item_id: 'slot-1' })
    act(() => session.emitTranscript({ id: 'i', speaker: 'interviewer', text: 'Sure', final: true, at: Date.now() + 1 }))
    expect(ref.current!.ask).not.toBeNull()
    act(() => session.emitTranscript({ id: 'c', speaker: 'candidate', text: 'What does this mean?', final: true, at: Date.now() + 2 }))
    expect(ref.current!.ask).toBeNull()
  })
})

describe('WorkspaceProvider room state', () => {
  const STATE = (layout: 'talk' | 'work', slow = false): AgentMessageBody => ({ type: 'room.state', layout, slow })

  function mountRoom() {
    const session = new MockLiveSession()
    const ref: { current: RoomView | null } = { current: null }
    const ws: { current: Ws | null } = { current: null }
    let renders = 0
    function Probe() {
      ref.current = useRoomState()
      ws.current = useWorkspace()
      renders += 1
      return null
    }
    render(<WorkspaceProvider session={session}><Probe /></WorkspaceProvider>)
    const agent = async (body: AgentMessageBody) => {
      const m = stampAgent(body)
      await act(async () => { session.emitMessage(m) })
      return m.id
    }
    return { session, ref, ws, agent, renders: () => renders }
  }

  it('is a plain conversation outside a provider and before the interviewer says anything', () => {
    const outside = renderHook(() => useRoomState())
    expect(outside.result.current).toEqual({ layout: 'talk', slow: false })
    const { ref } = mountRoom()
    expect(ref.current).toEqual({ layout: 'talk', slow: false })
  })

  it('follows the interviewer: layout and slow are replaced by each message, and each is acknowledged', async () => {
    const { session, ref, agent } = mountRoom()
    const first = await agent(STATE('work'))
    expect(ref.current).toEqual({ layout: 'work', slow: false })
    const second = await agent(STATE('work', true))
    expect(ref.current).toEqual({ layout: 'work', slow: true })
    await agent(STATE('talk'))
    expect(ref.current).toEqual({ layout: 'talk', slow: false })
    expect(session.sentOf('ack').find((a) => a.ref === first)).toMatchObject({ ok: true })
    expect(session.sentOf('ack').find((a) => a.ref === second)).toMatchObject({ ok: true })
  })

  it('takes a repeated state (sent again after a hello) without changing anything', async () => {
    const { ref, agent, renders } = mountRoom()
    await agent(STATE('work', true))
    const before = ref.current
    const rendersBefore = renders()
    await agent(STATE('work', true))
    expect(ref.current).toBe(before)
    expect(renders()).toBe(rendersBefore) // no re-render for a message that changes nothing
  })

  it('leaves the problems and the editor alone', async () => {
    const { ws, agent } = mountRoom()
    const code: CodeApi = { apply: vi.fn(() => ({ ok: true as const })), restore: vi.fn(), hasContent: () => true }
    act(() => ws.current!.registerCode(code))
    await agent(SHOW)
    await agent(STATE('work'))
    await agent(STATE('talk', true))
    expect(ws.current!.panel.cards.map((c) => c.label)).toEqual(['Problem 1'])
    expect(code.apply).not.toHaveBeenCalled()
    expect(code.restore).not.toHaveBeenCalled()
  })
})
