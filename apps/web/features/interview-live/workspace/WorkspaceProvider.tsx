'use client'
/**
 * The shared workspace (spec §6). Routes the interviewer's instructions to the panel state and to the
 * editor/whiteboard adapters they register, acknowledges each one, and sends the candidate's own
 * notes, highlights and Ask selections. Also holds the room's layout state (surface, expansion).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { newMessageId, type AgentMessage, type AgentMessageOf, type CodeLanguage } from '../protocol/messages'
import type { AgentState, LiveSession } from '../session/types'
import { EMPTY_PANEL, cardFromWire, findQuote, hasCard, panelReducer, type PanelAction, type PanelState } from './panel'

export type AckResult = { ok: true } | { ok: false; reason: string }
export type CodeInstruction = AgentMessageOf<'code.comment' | 'code.insert' | 'code.highlight' | 'code.clear_highlight'>

export interface CodeApi {
  apply(m: CodeInstruction): AckResult
  restore(code: { language: CodeLanguage; text: string }): void
  hasContent(): boolean
}

export interface BoardApi {
  draw(m: AgentMessageOf<'board.draw'>): AckResult
  snapshotPng(): Promise<Uint8Array | null>
  restore(data: Uint8Array, attributes: Record<string, string>): Promise<void>
  hasContent(): boolean
}

export type Surface = 'code' | 'board'
/** Which half of the right side fills it: the problem panel, the work area, or neither. */
export type Expanded = 'none' | 'panel' | 'work'

export interface AskSelection {
  surface: 'statement' | 'code' | 'board'
  quote: string
  itemId?: string
  lines?: [number, number]
  at: number
}

interface WorkspaceCtx {
  panel: PanelState
  selectCard(itemId: string): void
  clearFlash(): void
  addNote(itemId: string, body: string): void
  addHighlight(itemId: string, quote: string, occurrence: number): void
  ask: AskSelection | null
  askAbout(sel: Omit<AskSelection, 'at'>): void
  clearAsk(): void
  registerCode(api: CodeApi | null): void
  registerBoard(api: BoardApi | null): void
  surface: Surface
  setSurface(s: Surface): void
  boardAttention: boolean
  expanded: Expanded
  setExpanded(e: Expanded): void
  panelFull: boolean
  setPanelFull(on: boolean): void
}

const Ctx = createContext<WorkspaceCtx | null>(null)

export function WorkspaceProvider({ session, children }: { session: LiveSession; children: React.ReactNode }) {
  const [panel, setPanel] = useState<PanelState>(EMPTY_PANEL)
  const panelRef = useRef(panel)
  const code = useRef<CodeApi | null>(null)
  const board = useRef<BoardApi | null>(null)
  const pendingBoard = useRef<{ data: Uint8Array; attributes: Record<string, string> } | null>(null)
  const pendingCode = useRef<{ language: CodeLanguage; text: string } | null>(null)
  const [ask, setAskState] = useState<AskSelection | null>(null)
  const askRef = useRef(ask)
  const [surface, setSurfaceState] = useState<Surface>('code')
  const surfaceRef = useRef(surface)
  const [boardAttention, setBoardAttention] = useState(false)
  const [expanded, setExpanded] = useState<Expanded>('none')
  const [panelFull, setPanelFull] = useState(false)

  const applyPanel = useCallback((a: PanelAction) => {
    panelRef.current = panelReducer(panelRef.current, a)
    setPanel(panelRef.current)
  }, [])
  const setAsk = useCallback((a: AskSelection | null) => {
    askRef.current = a
    setAskState(a)
  }, [])
  const setSurface = useCallback((s: Surface) => {
    surfaceRef.current = s
    setSurfaceState(s)
    if (s === 'board') setBoardAttention(false)
  }, [])

  const handle = useCallback(async (m: AgentMessage): Promise<AckResult | null> => {
    switch (m.type) {
      case 'panel.show_problem':
        applyPanel({ type: 'show', card: { itemId: m.item_id, label: m.label, kind: m.kind, statement: m.statement, examples: m.examples } })
        setExpanded((e) => (e === 'work' ? 'none' : e))
        return { ok: true }
      case 'panel.add_section':
        if (!hasCard(panelRef.current, m.item_id)) return { ok: false, reason: 'unknown_item' }
        applyPanel({ type: 'add_section', itemId: m.item_id, section: m.section })
        return { ok: true }
      case 'panel.highlight': {
        const card = panelRef.current.cards.find((c) => c.itemId === m.item_id)
        if (!card) return { ok: false, reason: 'unknown_item' }
        const occurrence = m.occurrence ?? 0
        if (!findQuote(card.statement, m.quote, occurrence)) return { ok: false, reason: 'quote_not_found' }
        applyPanel({ type: 'highlight', itemId: m.item_id, highlight: { id: m.highlight_id, quote: m.quote, occurrence, note: m.note, author: 'interviewer' } })
        return { ok: true }
      }
      case 'panel.clear_highlight':
        applyPanel({ type: 'clear_highlight', highlightId: m.highlight_id })
        return { ok: true }
      case 'code.comment':
      case 'code.insert':
      case 'code.highlight':
      case 'code.clear_highlight':
        return code.current ? code.current.apply(m) : { ok: false, reason: 'editor_not_ready' }
      case 'board.draw': {
        if (!board.current) return { ok: false, reason: 'board_not_ready' }
        const result = board.current.draw(m)
        if (result.ok && surfaceRef.current !== 'board') setBoardAttention(true)
        return result
      }
      case 'board.request_snapshot': {
        if (!board.current) return { ok: false, reason: 'board_not_ready' }
        const png = await board.current.snapshotPng()
        if (!png) return { ok: false, reason: 'board_empty' }
        await session.sendBytes('board.snapshot', png, { request_id: m.request_id })
        return { ok: true }
      }
      case 'workspace.restore':
        applyPanel({ type: 'restore', cards: m.cards.map(cardFromWire), activeId: m.active_item_id })
        if (m.code) {
          if (code.current) code.current.restore(m.code)
          else pendingCode.current = m.code // the editor loads after the room; it takes this when it registers
        }
        return { ok: true }
      case 'session.ending':
        return null // LiveSessionProvider ends the round
    }
  }, [applyPanel, session])

  useEffect(() => session.onMessage((m) => {
    void handle(m).then((r) => {
      if (r) session.send({ type: 'ack', ref: m.id, ok: r.ok, ...(r.ok ? {} : { reason: r.reason }) })
    })
  }), [session, handle])

  useEffect(() => session.onBoardRestore((data, attributes) => {
    if (board.current) void board.current.restore(data, attributes)
    else pendingBoard.current = { data, attributes }
  }), [session])

  // The candidate's next finished question carries the Ask selection; then it's done.
  useEffect(() => session.onTranscript((s) => {
    const a = askRef.current
    if (a && s.speaker === 'candidate' && s.final && s.at >= a.at) setAsk(null)
  }), [session, setAsk])

  // The interviewer sends no workspace instruction before this (spec §6.1). It is usually not in the room yet
  // when the page mounts, and a message sent before it joins is lost, so hello goes out again each time the
  // interviewer appears (first join, a restart, a re-dispatch).
  useEffect(() => {
    const hello = () => session.send({ type: 'workspace.hello', has_content: panelRef.current.cards.length > 0 })
    hello()
    let last: AgentState = 'absent'
    return session.onAgentState((s) => {
      if (last === 'absent' && s !== 'absent') hello()
      last = s
    })
  }, [session])

  // Every callback is stable: the editor and whiteboard register from mount effects and unregister in
  // their cleanup, so a callback that changed identity would unregister them on every render.
  const selectCard = useCallback((itemId: string) => applyPanel({ type: 'select', itemId }), [applyPanel])
  const clearFlash = useCallback(() => applyPanel({ type: 'flash_done' }), [applyPanel])
  const addNote = useCallback((itemId: string, body: string) => {
    const section = { id: newMessageId('sec'), kind: 'note' as const, title: 'Note', body, author: 'candidate' as const }
    applyPanel({ type: 'add_section', itemId, section })
    session.send({ type: 'panel.section_added', item_id: itemId, section })
  }, [applyPanel, session])
  const addHighlight = useCallback((itemId: string, quote: string, occurrence: number) => {
    const id = newMessageId('hl')
    applyPanel({ type: 'highlight', itemId, highlight: { id, quote, occurrence, author: 'candidate' } })
    session.send({ type: 'panel.highlight_added', item_id: itemId, highlight_id: id, quote, occurrence })
  }, [applyPanel, session])
  const askAbout = useCallback((sel: Omit<AskSelection, 'at'>) => {
    setAsk({ ...sel, at: Date.now() })
    session.send({
      type: 'ask.selection', surface: sel.surface, quote: sel.quote.slice(0, 4000),
      ...(sel.itemId ? { item_id: sel.itemId } : {}),
      ...(sel.lines ? { lines: sel.lines } : {}),
    })
  }, [session, setAsk])
  const clearAsk = useCallback(() => setAsk(null), [setAsk])
  const registerCode = useCallback((api: CodeApi | null) => {
    code.current = api
    if (api && pendingCode.current) {
      api.restore(pendingCode.current)
      pendingCode.current = null
    }
  }, [])
  const registerBoard = useCallback((api: BoardApi | null) => {
    board.current = api
    if (api && pendingBoard.current) {
      void api.restore(pendingBoard.current.data, pendingBoard.current.attributes)
      pendingBoard.current = null
    }
  }, [])

  const value = useMemo<WorkspaceCtx>(() => ({
    panel, selectCard, clearFlash, addNote, addHighlight, ask, askAbout, clearAsk, registerCode, registerBoard,
    surface, setSurface, boardAttention, expanded, setExpanded, panelFull, setPanelFull,
  }), [panel, selectCard, clearFlash, addNote, addHighlight, ask, askAbout, clearAsk, registerCode, registerBoard, surface, setSurface, boardAttention, expanded, panelFull])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useWorkspace(): WorkspaceCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useWorkspace must be used within a WorkspaceProvider')
  return v
}
