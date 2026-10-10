import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { InterviewerStrip } from './InterviewerStrip'

const strip = (layout: 'talk' | 'work') => (
  <InterviewerStrip name="Asha" agentState="listening" stream={null} micOn layout={layout} />
)

describe('InterviewerStrip', () => {
  it('is a compact strip in work: a small avatar and a small self-view', () => {
    render(strip('work'))
    expect(screen.getByText('Asha')).toBeInTheDocument()
    expect(screen.getByText('Listening')).toBeInTheDocument()
    expect(screen.getByTestId('camera-tile').parentElement).toHaveClass('h-[54px]', 'w-[72px]')
    expect(screen.getByTestId('avatar-bubble').parentElement).toHaveClass('h-[38px]', 'w-[38px]')
    expect(screen.queryByText('You')).not.toBeInTheDocument()
  })

  it('is two large tiles side by side in talk, the self-view labelled', () => {
    render(strip('talk'))
    expect(screen.getByTestId('camera-tile').parentElement).toHaveClass('w-[calc(50%-8px)]')
    expect(screen.getByTestId('avatar-bubble').parentElement).toHaveClass('h-[88px]', 'w-[88px]')
    expect(screen.getByText('Asha')).toBeInTheDocument()
    expect(screen.getByText('You')).toBeInTheDocument()
  })

  it('keeps the same avatar and camera elements when the layout changes, so the video never restarts', () => {
    const { rerender } = render(strip('talk'))
    const camera = screen.getByTestId('camera-tile')
    const avatar = screen.getByTestId('avatar-bubble')
    rerender(strip('work'))
    expect(screen.getByTestId('camera-tile')).toBe(camera)
    expect(screen.getByTestId('avatar-bubble')).toBe(avatar)
    rerender(strip('talk'))
    expect(screen.getByTestId('camera-tile')).toBe(camera)
  })
})
