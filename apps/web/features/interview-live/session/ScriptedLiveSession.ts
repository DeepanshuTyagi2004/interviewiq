import { newMessageId, stampAgent, type AgentMessageBody, type WebMessage } from '../protocol/messages'
import { MockLiveSession } from './MockLiveSession'
import { GOODBYE, OPENING, askReply, proctorReply, type Step } from './script'

/** A scripted interviewer over MockLiveSession: it waits for the room's `workspace.hello` (as the real
 * agent does), plays OPENING, and reacts to Ask selections, proctoring events and End. It keeps the last
 * `room.state` it sent and repeats it after any later hello, as the real agent does. `speed` scales
 * every delay (1 = real time, 0 = immediately, for tests). */
export class ScriptedLiveSession extends MockLiveSession {
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()
  private started = false
  private roomState: Extract<AgentMessageBody, { type: 'room.state' }> = { type: 'room.state', layout: 'talk', slow: false }

  constructor(private readonly options: { speed?: number } = {}) {
    super()
  }

  override async disconnect(): Promise<void> {
    this.timers.forEach(clearTimeout)
    this.timers.clear()
    await super.disconnect()
  }

  protected override handleSent(m: WebMessage): void {
    switch (m.type) {
      case 'workspace.hello':
        if (!this.started) {
          this.started = true
          this.play(OPENING)
        } else {
          this.emitMessage(stampAgent(this.roomState))
        }
        break
      case 'ask.selection':
        this.play(askReply(m.quote, m.item_id))
        break
      case 'proctor.event':
        this.play(proctorReply(m))
        break
      case 'session.end_request':
        this.play(GOODBYE)
        break
      case 'activity.batch':
        console.debug('[iq-activity]', JSON.stringify(m.events))
        break
      default:
        break
    }
  }

  private play(steps: Step[]) {
    let at = 0
    for (const step of steps) {
      at += step.after
      const t = setTimeout(() => {
        this.timers.delete(t)
        this.run(step)
      }, at * (this.options.speed ?? 1))
      this.timers.add(t)
    }
  }

  private run(step: Step) {
    if ('say' in step) this.say(step.say)
    else if ('message' in step) this.sendMessage(step.message)
    else if ('state' in step) this.emitAgentState(step.state)
    else void this.disconnect()
  }

  private sendMessage(body: AgentMessageBody) {
    if (body.type === 'room.state') this.roomState = body // remembered, to repeat after a later hello
    this.emitMessage(stampAgent(body))
  }

  private say(text: string) {
    const id = newMessageId('seg')
    const at = Date.now()
    this.emitAgentState('speaking')
    this.emitTranscript({ id, speaker: 'interviewer', text: text.split(' ').slice(0, 4).join(' '), final: false, at })
    this.emitTranscript({ id, speaker: 'interviewer', text, final: true, at })
    this.emitAgentState('listening')
  }
}
