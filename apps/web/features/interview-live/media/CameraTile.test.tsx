import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CameraTile } from './CameraTile'

describe('CameraTile', () => {
  it('renders a muted video element bound to the given stream', () => {
    // @ts-expect-error MediaStream constructor doesn't accept string array, but we're using it as a test double
    const stream = new MediaStream(['audio', 'video']) as unknown as MediaStream
    render(<CameraTile stream={stream} />)
    const video = screen.getByTestId('camera-tile').querySelector('video')
    expect(video).toBeInTheDocument()
    expect(video).toHaveProperty('muted', true)
  })

  it('renders with a null stream without throwing', () => {
    render(<CameraTile stream={null} label="You" />)
    expect(screen.getByText('You')).toBeInTheDocument()
  })
})
