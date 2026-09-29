import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkArea } from './WorkArea'
import { MockLiveSession } from '../session/MockLiveSession'

vi.mock('./CodeEditor', () => ({ CodeEditor: () => <div data-testid="code-editor" /> }))
vi.mock('./DiagramBoard', () => ({ DiagramBoard: () => <div data-testid="diagram-board" /> }))

describe('WorkArea', () => {
  it('renders both tab triggers', () => {
    render(<WorkArea session={new MockLiveSession()} />)
    expect(screen.getByRole('tab', { name: /code editor/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /excalidraw/i })).toBeInTheDocument()
  })

  it('keeps both surfaces mounted, showing the diagram board after clicking its tab', async () => {
    const user = userEvent.setup()
    render(<WorkArea session={new MockLiveSession()} />)

    // both mounted from the start (forceMount) — code editor visible, diagram hidden
    expect(screen.getByTestId('code-editor')).toBeInTheDocument()
    expect(screen.getByTestId('diagram-board')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /excalidraw/i }))

    const diagramPanel = screen.getByTestId('diagram-board').closest('[role="tabpanel"]')
    const codePanel = screen.getByTestId('code-editor').closest('[role="tabpanel"]')
    expect(diagramPanel).not.toHaveClass('hidden')
    expect(codePanel).toHaveClass('hidden')
  })

  it('expand icon opens the fullscreen popout, collapse closes it', async () => {
    const user = userEvent.setup()
    render(<WorkArea session={new MockLiveSession()} />)

    expect(screen.queryByTestId('work-popout')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /expand/i }))
    expect(screen.getByTestId('work-popout')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /collapse/i }))
    expect(screen.queryByTestId('work-popout')).not.toBeInTheDocument()
  })
})
