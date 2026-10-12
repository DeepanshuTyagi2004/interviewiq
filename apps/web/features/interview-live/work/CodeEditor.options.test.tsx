import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MockLiveSession } from '../session/MockLiveSession'
import { WorkspaceProvider } from '../workspace/WorkspaceProvider'
import { CodeEditor } from './CodeEditor'

vi.mock('next/dynamic', () => ({ default: () => ({ options }: { options: object }) => <div data-testid="monaco" data-options={JSON.stringify(options)} /> }))
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'dark' }) }))

afterEach(() => { vi.unstubAllEnvs() })

function optionsOf(): Record<string, unknown> {
  const session = new MockLiveSession()
  render(<WorkspaceProvider session={session}><CodeEditor session={session} /></WorkspaceProvider>)
  return JSON.parse(screen.getByTestId('monaco').getAttribute('data-options')!)
}

describe('CodeEditor options', () => {
  it('never offers completions, even in dev', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXT_PUBLIC_ENFORCE_CLIPBOARD', '')
    expect(optionsOf()).toMatchObject({ quickSuggestions: false, snippetSuggestions: 'none', minimap: { enabled: false } })
  })

  it('leaves native paste, drop and the context menu alone in dev', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXT_PUBLIC_ENFORCE_CLIPBOARD', '')
    const options = optionsOf()
    expect(options).not.toHaveProperty('contextmenu')
    expect(options).not.toHaveProperty('dropIntoEditor')
  })

  it('closes the paste side doors in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(optionsOf()).toMatchObject({ contextmenu: false, dropIntoEditor: { enabled: false }, pasteAs: { enabled: false }, dragAndDrop: false })
  })
})
