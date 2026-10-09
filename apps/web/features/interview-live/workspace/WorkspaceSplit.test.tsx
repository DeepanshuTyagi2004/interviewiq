import { describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MockLiveSession } from '../session/MockLiveSession'
import { WorkspaceProvider, useWorkspace } from './WorkspaceProvider'
import { DEFAULT_FRACTION, WorkspaceSplit } from './WorkspaceSplit'


type Ws = ReturnType<typeof useWorkspace>
function mount() {
  const wsRef: { current: Ws | null } = { current: null }
  function Probe() {
    wsRef.current = useWorkspace()
    return null
  }
  render(
    <WorkspaceProvider session={new MockLiveSession()}>
      <WorkspaceSplit panel={<div>panel</div>} work={<div>work</div>} />
      <Probe />
    </WorkspaceProvider>,
  )
  return wsRef
}

describe('WorkspaceSplit', () => {
  it('starts the panel at 20% and resizes it from the keyboard', () => {
    mount()
    const sep = screen.getByRole('separator', { name: 'Resize problem panel' })
    expect(sep).toHaveAttribute('aria-valuenow', String(DEFAULT_FRACTION * 100))
    fireEvent.keyDown(sep, { key: 'ArrowDown' })
    expect(sep).toHaveAttribute('aria-valuenow', '25')
  })

  it('hides the work area while the panel fills the right side, and the separator in any expanded mode', () => {
    const wsRef = mount()
    act(() => wsRef.current!.setExpanded('panel'))
    expect(screen.getByText('work').parentElement).toHaveClass('hidden')
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
  })
})
