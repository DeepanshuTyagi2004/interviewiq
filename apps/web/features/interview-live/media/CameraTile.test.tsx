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

  it('shows the candidate their own camera mirrored, like a selfie view', () => {
    render(<CameraTile stream={null} label="You" />)
    expect(screen.getByTestId('camera-tile').querySelector('video')).toHaveClass('-scale-x-100')
  })

  it('renders with a null stream without throwing', () => {
    render(<CameraTile stream={null} label="You" />)
    expect(screen.getByText('You')).toBeInTheDocument()
  })

  it('draws the camera check as a green, amber or red border, and none while it starts', () => {
    const { rerender } = render(<CameraTile stream={null} check="ok" />)
    expect(screen.getByTestId('camera-check')).toHaveAttribute('data-check', 'ok')
    expect(screen.getByText('Camera check: OK')).toBeInTheDocument()
    rerender(<CameraTile stream={null} check="violation" />)
    expect(screen.getByTestId('camera-check')).toHaveClass('border-destructive')
    rerender(<CameraTile stream={null} check="starting" />)
    expect(screen.queryByTestId('camera-check')).not.toBeInTheDocument()
    rerender(<CameraTile stream={null} check="unavailable" />)
    expect(screen.queryByTestId('camera-check')).not.toBeInTheDocument()
  })
})
