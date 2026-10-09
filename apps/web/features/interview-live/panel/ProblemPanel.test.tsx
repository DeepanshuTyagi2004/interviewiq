import { describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { stampAgent, type AgentMessageBody } from '../protocol/messages'
import { MockLiveSession } from '../session/MockLiveSession'
import { ActivityProvider } from '../activity/ActivityProvider'
import { WorkspaceProvider, useWorkspace } from '../workspace/WorkspaceProvider'
import { ProblemPanel } from './ProblemPanel'


const STATEMENT = 'Return the longest substring with at most two distinct characters.'
type Ws = ReturnType<typeof useWorkspace>
function mount() {
  const session = new MockLiveSession()
  const wsRef: { current: Ws | null } = { current: null }
  function Probe() {
    wsRef.current = useWorkspace()
    return null
  }
  render(<WorkspaceProvider session={session}><ProblemPanel /><Probe /></WorkspaceProvider>)
  const agent = (body: AgentMessageBody) => act(async () => { session.emitMessage(stampAgent(body)) })
  return { session, agent, wsRef }
}
const SHOW: AgentMessageBody = {
  type: 'panel.show_problem', item_id: 'slot-1', label: 'Problem 1', kind: 'problem', statement: STATEMENT,
  examples: [{ input: 's = "eceba"', output: '3', explanation: 'The substring is "ece".' }, { input: 's = "ccaabbb"', output: '5' }],
}

/** Selects `text` inside `el` (whichever text node holds it, since highlights split the statement). */
function selectText(el: HTMLElement, text: string) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode() as Text | null
  while (node && !node.data.includes(text)) node = walker.nextNode() as Text | null
  if (!node) throw new Error(`"${text}" is not in the statement`)
  const start = node.data.indexOf(text)
  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(node, start + text.length)
  const sel = window.getSelection()!
  sel.removeAllRanges()
  sel.addRange(range)
  fireEvent.mouseUp(el)
}

describe('ProblemPanel', () => {
  it('waits for the interviewer, then shows the statement and both examples under a generic label', async () => {
    const { agent } = mount()
    expect(screen.getByText(/interviewer will put the problem here/i)).toBeInTheDocument()
    await agent(SHOW)
    expect(screen.getByRole('tab', { name: 'Problem 1', selected: true })).toBeInTheDocument()
    expect(screen.getByText(STATEMENT)).toBeInTheDocument()
    expect(screen.getByText('Example 1')).toBeInTheDocument()
    expect(screen.getByText('Example 2')).toBeInTheDocument()
    expect(screen.queryByText(/constraints/i)).not.toBeInTheDocument()
  })

  it('shows interviewer sections and highlights in the interviewer colour', async () => {
    const { agent } = mount()
    await agent(SHOW)
    await agent({ type: 'panel.add_section', item_id: 'slot-1', section: { id: 'c', kind: 'constraints', title: 'Constraints', body: '1 <= n <= 10^5', author: 'interviewer' } })
    await agent({ type: 'panel.highlight', item_id: 'slot-1', highlight_id: 'h', quote: 'two distinct' })
    expect(screen.getByRole('article', { name: 'Constraints' })).toHaveTextContent('1 <= n <= 10^5')
    const mark = document.querySelector('mark[data-author="interviewer"]')
    expect(mark).toHaveTextContent('two distinct')
  })

  it('lets the candidate highlight or ask about selected statement text', async () => {
    const { session, agent } = mount()
    await agent(SHOW)
    const text = screen.getByTestId('statement-text')
    selectText(text, 'longest substring')
    await userEvent.click(screen.getByRole('button', { name: 'Highlight' }))
    expect(document.querySelector('mark[data-author="candidate"]')).toHaveTextContent('longest substring')
    expect(session.sentOf('panel.highlight_added')[0]).toMatchObject({ quote: 'longest substring', occurrence: 0 })
    selectText(screen.getByTestId('statement-text'), 'at most')
    await userEvent.click(screen.getByRole('button', { name: 'Ask' }))
    expect(session.sentOf('ask.selection')[0]).toMatchObject({ surface: 'statement', quote: 'at most', item_id: 'slot-1' })
  })

  it('saves a candidate note', async () => {
    const { session, agent } = mount()
    await agent(SHOW)
    await userEvent.click(screen.getByRole('button', { name: 'Add a note' }))
    await userEvent.type(screen.getByLabelText('Note'), 'Use two pointers?')
    await userEvent.click(screen.getByRole('button', { name: 'Save note' }))
    expect(screen.getByRole('article', { name: 'Note' })).toHaveTextContent('Use two pointers?')
    expect(session.sentOf('panel.section_added')).toHaveLength(1)
  })

  it('expands, goes full screen, and shrinks to a label strip while the work area is expanded', async () => {
    const { agent, wsRef } = mount()
    await agent(SHOW)
    await userEvent.click(screen.getByRole('button', { name: 'Expand problem panel' }))
    expect(wsRef.current!.expanded).toBe('panel')
    await userEvent.click(screen.getByRole('button', { name: 'Problem full screen' }))
    expect(screen.getByTestId('panel-full')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Exit problem full screen' }))
    act(() => wsRef.current!.setExpanded('work'))
    expect(screen.queryByText(STATEMENT)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Problem 1' }))
    expect(wsRef.current!.expanded).toBe('none')
  })
})

describe('ProblemPanel activity', () => {
  it('reports the sentence under the pointer to the interviewer', async () => {
    const session = new MockLiveSession()
    render(
      <ActivityProvider session={session}>
        <WorkspaceProvider session={session}><ProblemPanel /></WorkspaceProvider>
      </ActivityProvider>,
    )
    act(() => session.emitMessage(stampAgent({
      type: 'panel.show_problem', item_id: 'p1', label: 'Problem 1', kind: 'problem', examples: [],
      statement: 'Find the pair. Return the indices.',
    })))
    const statement = screen.getByTestId('statement-text')
    const text = statement.firstChild!.firstChild as Text
    const original = document.caretPositionFromPoint
    document.caretPositionFromPoint = (() => ({ offsetNode: text, offset: 18 })) as unknown as typeof document.caretPositionFromPoint
    try {
      fireEvent.mouseMove(statement, { clientX: 5, clientY: 5 })
      await waitFor(() => expect(session.sentOf('activity.batch')[0]?.events).toEqual([expect.objectContaining({ k: 'ptr', s: 'panel', quote: 'Return the indices.' })]), { timeout: 2000 })
    } finally {
      document.caretPositionFromPoint = original
    }
  })
})
