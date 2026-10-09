import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { MockLiveSession } from '../session/MockLiveSession'
import { ActivityPane, ActivityProvider, useActivity } from './ActivityProvider'
import { FLUSH_MS } from './batcher'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

function Recorder({ times = 1 }: { times?: number }) {
  const { record } = useActivity()
  useEffect(() => {
    for (let i = 0; i < times; i++) record({ k: 'focus', s: 'code' })
  }, [record, times])
  return null
}

describe('ActivityProvider', () => {
  it('sends what the room records as one activity batch', () => {
    const session = new MockLiveSession()
    render(<ActivityProvider session={session}><Recorder /></ActivityProvider>)
    act(() => { vi.advanceTimersByTime(FLUSH_MS) })
    expect(session.sentOf('activity.batch')).toEqual([expect.objectContaining({ events: [expect.objectContaining({ k: 'focus', s: 'code' })] })])
  })

  it('sends nothing once the room has unmounted', () => {
    const session = new MockLiveSession()
    const view = render(<ActivityProvider session={session}><Recorder /></ActivityProvider>)
    view.unmount()
    act(() => { vi.advanceTimersByTime(FLUSH_MS * 2) })
    expect(session.sentOf('activity.batch')).toHaveLength(0)
  })

  it('swallows a send that fails while disconnected', () => {
    const session = new MockLiveSession()
    session.send = () => { throw new Error('not connected') }
    render(<ActivityProvider session={session}><Recorder /></ActivityProvider>)
    expect(() => act(() => { vi.advanceTimersByTime(FLUSH_MS) })).not.toThrow()
  })

  it('is a no-op for panes mounted without a provider', () => {
    expect(() => render(<Recorder />)).not.toThrow()
  })

  it('records the pointer leaving the workspace pane', () => {
    const session = new MockLiveSession()
    render(<ActivityProvider session={session}><ActivityPane aria-label="Workspace" /></ActivityProvider>)
    fireEvent.mouseLeave(screen.getByRole('region', { name: 'Workspace' }))
    act(() => { vi.advanceTimersByTime(FLUSH_MS) })
    expect(session.sentOf('activity.batch')[0].events).toEqual([expect.objectContaining({ k: 'ptr', s: 'out' })])
  })
})
