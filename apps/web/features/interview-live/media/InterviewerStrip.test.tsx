import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { agentStateToOrb, InterviewerStrip } from './InterviewerStrip'

const strip = (layout: 'talk' | 'work') => (
  <InterviewerStrip name="Asha" agentState="listening" stream={null} micOn layout={layout} />
)

describe('agentStateToOrb', () => {
  it('maps every agent state to its orb motion', () => {
    expect(agentStateToOrb('absent')).toBe('still')
    expect(agentStateToOrb('initializing')).toBe('breathing')
    expect(agentStateToOrb('listening')).toBe('listening')
    expect(agentStateToOrb('thinking')).toBe('thinking')
    expect(agentStateToOrb('speaking')).toBe('speaking')
  })
})

describe('InterviewerStrip', () => {
  it('is a compact strip in work: a 40 px orb and a small self-view', () => {
    render(strip('work'))
    expect(screen.getByText('Asha')).toBeInTheDocument()
    expect(screen.getByText('Listening')).toBeInTheDocument()
    expect(screen.getByTestId('camera-tile').parentElement).toHaveClass('h-[54px]', 'w-[72px]')
    expect(screen.getByTestId('interviewer-orb')).toHaveClass('h-[40px]', 'w-[40px]')
    expect(screen.queryByText('You')).not.toBeInTheDocument()
  })

  it('puts the 160 px orb on the stage in talk, with a small labelled self-view', () => {
    render(strip('talk'))
    expect(screen.getByTestId('camera-tile').parentElement).toHaveClass('h-[108px]', 'w-[144px]')
    expect(screen.getByTestId('interviewer-orb')).toHaveClass('h-[160px]', 'w-[160px]')
    expect(screen.getByText('Asha')).toBeInTheDocument()
    expect(screen.getByText('You')).toBeInTheDocument()
  })

  it('keeps the same orb and camera elements when the layout changes, so the video never restarts', () => {
    const { rerender } = render(strip('talk'))
    const camera = screen.getByTestId('camera-tile')
    const orb = screen.getByTestId('interviewer-orb')
    rerender(strip('work'))
    expect(screen.getByTestId('camera-tile')).toBe(camera)
    expect(screen.getByTestId('interviewer-orb')).toBe(orb)
    rerender(strip('talk'))
    expect(screen.getByTestId('camera-tile')).toBe(camera)
  })
})
