import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ViolationOverlay } from './ViolationOverlay'
import { MockLiveSession } from '../session/MockLiveSession'

describe('ViolationOverlay', () => {
  it('renders the message and Return to full-screen button; clicking it calls onReturn', async () => {
    const session = new MockLiveSession()
    const onReturn = vi.fn()
    const user = userEvent.setup()

    render(<ViolationOverlay session={session} onReturn={onReturn} />)

    expect(screen.getByText(/please return to full-screen to continue/i)).toBeInTheDocument()
    const button = screen.getByRole('button', { name: /return to full-screen/i })

    await user.click(button)

    expect(onReturn).toHaveBeenCalledTimes(1)
  })

  it('re-inserts the overlay node if removed from the DOM and reports an overlay_tamper event', async () => {
    const session = new MockLiveSession()
    const spy = vi.spyOn(session, 'sendProctorEvent')
    const onReturn = vi.fn()

    render(<ViolationOverlay session={session} onReturn={onReturn} />)

    const overlay = screen.getByTestId('violation-overlay')
    const parent = overlay.parentElement
    expect(parent).not.toBeNull()

    overlay.remove()
    expect(overlay.isConnected).toBe(false)

    // MutationObserver callbacks are delivered as a microtask — flush it (and a macrotask, to be
    // safe across environments) before asserting the DOM/session-side effects landed.
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(overlay.isConnected).toBe(true)
    expect(overlay.parentElement).toBe(parent)
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: 'overlay_tamper' }))
  })

  it('Q4: exposes the overlay as a modal dialog with an assertive live message', () => {
    const session = new MockLiveSession()
    const onReturn = vi.fn()

    render(<ViolationOverlay session={session} onReturn={onReturn} />)

    const overlay = screen.getByTestId('violation-overlay')
    expect(overlay).toHaveAttribute('role', 'dialog')
    expect(overlay).toHaveAttribute('aria-modal', 'true')

    const message = screen.getByText(/please return to full-screen to continue/i)
    expect(message).toHaveAttribute('aria-live', 'assertive')
  })

  it('Q4: moves focus to the Return button on mount, for keyboard users', () => {
    const session = new MockLiveSession()
    const onReturn = vi.fn()

    render(<ViolationOverlay session={session} onReturn={onReturn} />)

    const button = screen.getByRole('button', { name: /return to full-screen/i })
    expect(button).toHaveFocus()
  })
})
