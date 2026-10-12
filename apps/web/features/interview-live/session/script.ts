/**
 * The canned interview ScriptedLiveSession plays (local development and tests). A made-up demo
 * problem, not one from the bank. It exercises every workspace message the real interviewer uses,
 * including `room.state`: the room is a conversation (`talk`) until the problem is shown (`work`),
 * and a conversation again for the closing.
 */
import type { AgentMessageBody, WebMessage } from '../protocol/messages'
import type { AgentState } from './types'

export type Step = { after: number } & ({ say: string } | { message: AgentMessageBody } | { state: AgentState } | { disconnect: true })

/** A `room.state` step: the room's layout and whether the interviewer is slow to answer. */
const room = (after: number, layout: 'talk' | 'work', slow = false): Step => ({ after, message: { type: 'room.state', layout, slow } })

export const DEMO_ITEM = 'demo-1'
const STATEMENT =
  'Given a string s, return the length of the longest substring that contains at most two distinct characters. ' +
  'There is exactly one answer for every input.'

export const OPENING: Step[] = [
  room(0, 'talk'),
  { after: 600, say: "Hi, I'm Asha. Thanks for joining today. This is a mock coding round, so think out loud and ask me anything that's unclear." },
  room(300, 'talk', true), // the interviewer is slow to answer for a moment...
  room(1500, 'talk'), // ...then catches up
  room(700, 'work'), // the problem is about to appear: make room for it (the problem keeps its time, 3.1 s in)
  {
    after: 0,
    message: {
      type: 'panel.show_problem', item_id: DEMO_ITEM, label: 'Problem 1', kind: 'problem', statement: STATEMENT,
      examples: [
        { input: 's = "eceba"', output: '3', explanation: 'The substring is "ece".' },
        { input: 's = "ccaabbb"', output: '5', explanation: 'The substring is "aabbb".' },
      ],
    },
  },
  { after: 300, say: "The problem is on your screen. Take a minute to read it, and tell me how you'd approach it." },
  { after: 6000, message: { type: 'panel.highlight', item_id: DEMO_ITEM, highlight_id: 'demo-hl-1', quote: 'at most two distinct characters', note: 'The key condition.' } },
  { after: 400, say: 'Notice the condition I highlighted: at most two distinct characters.' },
  { after: 5000, message: { type: 'code.comment', at: 'top', text: "What's the time complexity of your current approach?", purpose: 'question' } },
  { after: 300, say: "I've left a question at the top of your editor." },
  {
    after: 6000,
    message: {
      type: 'board.draw',
      elements: [
        { type: 'rectangle', id: 'demo-in', label: 'input s' },
        { type: 'rectangle', id: 'demo-fn', label: 'your function' },
        { type: 'rectangle', id: 'demo-out', label: 'length' },
        { type: 'arrow', id: 'demo-a1', from: 'demo-in', to: 'demo-fn' },
        { type: 'arrow', id: 'demo-a2', from: 'demo-fn', to: 'demo-out' },
      ],
    },
  },
  { after: 300, say: "I've sketched the shape of it on the whiteboard, if that helps." },
]

const short = (q: string) => (q.length > 60 ? `${q.slice(0, 57)}…` : q)

export function askReply(quote: string, itemId: string = DEMO_ITEM): Step[] {
  return [
    { after: 700, say: `Good question about "${short(quote)}".` },
    {
      after: 300,
      message: {
        type: 'panel.add_section', item_id: itemId,
        section: { id: `demo-clar-${Date.now()}`, kind: 'clarification', title: 'Clarification', body: 'Characters are case-sensitive, and the string may be empty.', author: 'interviewer' },
      },
    },
    { after: 200, say: "I've added that to the problem." },
  ]
}

const MENTION: Record<Exclude<Extract<WebMessage, { type: 'proctor.event' }>['kind'], 'foreign_paste'>, string> = {
  tab_hidden: 'I noticed you switched tabs. Please stay on this screen.',
  window_blur: 'I noticed you moved to another window. Please stay on this screen.',
  external_display: 'I can see a second display. Please disconnect it.',
  fullscreen_exit: "You've left full screen. Please go back to it.",
  share_stopped: 'Your screen share stopped. Please share your entire screen again.',
}

/** Mirrors the spec §7 rule: mention every event; the 2nd full violation gets a final warning; the 3rd ends the round.
 * Text pasted from outside the editor ends the round at once (live integrity spec §2). */
export function proctorReply(event: Extract<WebMessage, { type: 'proctor.event' }>): Step[] {
  if (event.kind === 'foreign_paste') {
    return [
      { after: 400, say: "That text didn't come from this editor, and pasting outside text isn't allowed. I'm ending the interview here." },
      { after: 300, message: { type: 'session.ending', reason: 'ended_by_interviewer', message: "I'm ending the interview here because text was pasted from outside the editor." } },
      { after: 300, disconnect: true },
    ]
  }
  if (event.weight !== 1) return [{ after: 400, say: MENTION[event.kind] }]
  if (event.counts.full_violations >= 3) {
    return [
      { after: 400, say: "That's the third time. I'm ending the interview here because of repeated screen switching." },
      { after: 300, message: { type: 'session.ending', reason: 'ended_by_interviewer', message: "I'm ending the interview here because of repeated screen switching." } },
      { after: 300, disconnect: true },
    ]
  }
  if (event.counts.full_violations === 2) {
    return [{ after: 400, say: `${MENTION[event.kind]} This is your final warning: one more and I'll end the interview.` }]
  }
  return [{ after: 400, say: MENTION[event.kind] }]
}

export const GOODBYE: Step[] = [
  room(0, 'talk'), // the closing is a conversation again
  { after: 500, say: 'Thanks for your time today. Take care.' },
  { after: 300, message: { type: 'session.ending', reason: 'candidate_ended', message: 'You ended the interview.' } },
  { after: 300, disconnect: true },
]
