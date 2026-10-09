import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MockLiveSession } from '../session/MockLiveSession'
import { WorkspaceProvider, useWorkspace } from '../workspace/WorkspaceProvider'
import { WorkArea } from './WorkArea'

vi.mock('./CodeEditor', () => ({ CodeEditor: () => <div data-testid="code-editor" /> }))
vi.mock('./DiagramBoard', () => ({ DiagramBoard: () => <div data-testid="diagram-board" /> }))

describe('WorkArea', () => {
  it('keeps both surfaces mounted, shows the chosen one, and fills the right side on request', async () => {
    const session = new MockLiveSession()
    let ws: ReturnType<typeof useWorkspace> | null = null
    function Probe() { ws = useWorkspace(); return null }
    render(<WorkspaceProvider session={session}><WorkArea session={session} /><Probe /></WorkspaceProvider>)
    expect(screen.getByTestId('code-editor').parentElement).not.toHaveClass('hidden')
    expect(screen.getByTestId('diagram-board').parentElement).toHaveClass('hidden')
    act(() => ws!.setSurface('board'))
    expect(screen.getByRole('region', { name: 'Whiteboard' })).toBeInTheDocument()
    expect(screen.getByTestId('code-editor').parentElement).toHaveClass('hidden')
    await userEvent.click(screen.getByRole('button', { name: 'Expand work area' }))
    expect(ws!.expanded).toBe('work')
  })
})
