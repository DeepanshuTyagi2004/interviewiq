import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AvatarBubble } from './AvatarBubble'

describe('AvatarBubble', () => {
  it('renders the uppercased first initial of the name', () => {
    render(<AvatarBubble name="Ada" />)
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('applies the speaking ring class when speaking', () => {
    render(<AvatarBubble name="Ada" speaking />)
    expect(screen.getByTestId('avatar-bubble').className).toMatch(/ring-4/)
  })

  it('omits the speaking ring class when not speaking', () => {
    render(<AvatarBubble name="Ada" speaking={false} />)
    expect(screen.getByTestId('avatar-bubble').className).not.toMatch(/ring-4/)
  })
})
