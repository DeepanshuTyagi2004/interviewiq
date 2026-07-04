import { describe, it, expect } from 'vitest'
import { render, screen, renderHook, act } from '@testing-library/react'
import { LiveSessionProvider, useLiveSession } from './LiveSessionProvider'
import { MockLiveSession } from './MockLiveSession'

function Probe() {
  const { state, ctx } = useLiveSession()
  return (
    <div>
      <span data-testid="state">{state}</span>
      <span data-testid="violations">{ctx.violations}</span>
    </div>
  )
}

describe('LiveSessionProvider', () => {
  it('provides machine state, starting at prejoin', async () => {
    const session = new MockLiveSession()
    render(<LiveSessionProvider sessionId="s1" session={session}><Probe /></LiveSessionProvider>)
    expect(screen.getByTestId('state').textContent).toBe('prejoin')
    expect(screen.getByTestId('violations').textContent).toBe('0')
    // session stays connectable independent of provider render — sanity check the injected double is live
    await act(async () => { await session.connect('s1') })
    expect(session.connectionState).toBe('connected')
  })

  it('useLiveSession throws outside a provider', () => {
    expect(() => renderHook(() => useLiveSession())).toThrow('useLiveSession must be used within a LiveSessionProvider')
  })
})
