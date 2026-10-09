import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RoomHeader } from '@/app/(app)/interviews/[sessionId]/live/_components/RoomHeader'
import { EMPTY_LEDGER, recordEvent } from '../proctor/ledger'
import { ProctorBars } from '../proctor/ProctorBars'
import { MockLiveSession } from '../session/MockLiveSession'
import { stampAgent } from '../protocol/messages'
import { ToolRail } from '../work/ToolRail'
import { WorkspaceProvider, useWorkspace } from '../workspace/WorkspaceProvider'
import { BottomBar } from './BottomBar'

vi.mock('../proctor/screenShare', () => ({ requestEntireScreen: vi.fn(async () => ({ ok: false, reason: 'not_entire_screen' })) }))

describe('RoomHeader', () => {
  it('shows the round, the two counters and the clock', () => {
    const ledger = recordEvent(recordEvent(EMPTY_LEDGER, 'tab_hidden', 0).ledger, 'fullscreen_exit', 9000).ledger
    render(<RoomHeader meta={{ company: 'Salescode', level: 'SDE I', round: 'DSA', interviewer: 'Asha' }} ledger={ledger} />)
    expect(screen.getByText('Salescode · SDE I · DSA')).toBeInTheDocument()
    expect(screen.getByText('1 tab changes')).toBeInTheDocument()
    expect(screen.getByText('0.5')).toBeInTheDocument()
    expect(screen.getByRole('timer')).toHaveTextContent('00:00')
  })
})

describe('BottomBar', () => {
  it('toggles the mic and ends only after confirming', async () => {
    const onEnd = vi.fn()
    const onToggleMic = vi.fn()
    render(<BottomBar micOn stream={null} onToggleMic={onToggleMic} onEnd={onEnd} />)
    await userEvent.click(screen.getByRole('button', { name: /mute microphone/i }))
    expect(onToggleMic).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'End interview' }))
    expect(onEnd).not.toHaveBeenCalled()
    const confirm = screen.getAllByRole('button', { name: 'End interview' }).at(-1)!
    await userEvent.click(confirm)
    expect(onEnd).toHaveBeenCalled()
  })
})

describe('ToolRail', () => {
  it('switches tools and shows a dot when the interviewer draws on the hidden whiteboard', async () => {
    const session = new MockLiveSession()
    let ws: ReturnType<typeof useWorkspace> | null = null
    function Probe() { ws = useWorkspace(); return null }
    render(<WorkspaceProvider session={session}><ToolRail /><Probe /></WorkspaceProvider>)
    act(() => ws!.registerBoard({ draw: () => ({ ok: true }), snapshotPng: async () => null, restore: async () => {}, hasContent: () => false }))
    await act(async () => { session.emitMessage(stampAgent({ type: 'board.draw', elements: [{ type: 'rectangle', id: 'n' }] })) })
    expect(screen.getByTestId('board-attention')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Whiteboard' }))
    expect(screen.getByRole('button', { name: 'Whiteboard' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('board-attention')).not.toBeInTheDocument()
  })
})

describe('ProctorBars', () => {
  it('shows the warning toast and both recovery bars', async () => {
    render(<ProctorBars outOfFullscreen shareStopped toast="Don't change screens while the interview is running." />)
    expect(screen.getByRole('alert')).toHaveTextContent("Don't change screens")
    await userEvent.click(screen.getByRole('button', { name: 'Return to full screen' }))
    expect(document.documentElement.requestFullscreen).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Share screen again' }))
    expect(await screen.findByText('Share your entire screen, not a window or tab.')).toBeInTheDocument()
  })
})

describe('ProctorBars presence', () => {
  it('shows a quiet bar while the interviewer is joining or reconnecting, and nothing when present', () => {
    const { rerender } = render(<ProctorBars outOfFullscreen={false} shareStopped={false} toast={null} presence="joining" />)
    expect(screen.getByRole('status')).toHaveTextContent('Connecting to your interviewer…')
    rerender(<ProctorBars outOfFullscreen={false} shareStopped={false} toast={null} presence="reconnecting" />)
    expect(screen.getByRole('status')).toHaveTextContent('Your interviewer is reconnecting…')
    rerender(<ProctorBars outOfFullscreen={false} shareStopped={false} toast={null} presence="present" />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
