import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SelectionToolbar } from './SelectionToolbar'

const props = { top: 10, left: 20, onAsk: vi.fn(), onDismiss: vi.fn() }

describe('SelectionToolbar', () => {
  it('sits above the selection by default', () => {
    render(<SelectionToolbar {...props} />)
    expect(screen.getByRole('toolbar', { name: 'Selection' }).className).toContain('-translate-y-[calc(100%+6px)]')
  })

  it('sits below the selection when asked, so a selection at the top of the panel is not cut off', () => {
    render(<SelectionToolbar {...props} placement="below" />)
    const cls = screen.getByRole('toolbar', { name: 'Selection' }).className
    expect(cls).toContain('translate-y-[6px]')
    expect(cls).not.toContain('-translate-y-[calc(100%+6px)]')
  })
})
