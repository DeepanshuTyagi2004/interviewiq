'use client'
import { Waveform } from '@/components/visualizations/Waveform'
import { cn } from '@/lib/utils/cn'
import type { AgentState } from '../session/types'
import { AvatarBubble } from './AvatarBubble'
import { CameraTile } from './CameraTile'

const STATE_LABEL: Record<AgentState, string> = {
  absent: 'Connecting',
  initializing: 'Joining',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
}

/** The top of the left column: the interviewer's avatar, waveform and state, and a small self-view. */
export function InterviewerStrip({ name, agentState, stream, micOn }: { name: string; agentState: AgentState; stream: MediaStream | null; micOn: boolean }) {
  const speaking = agentState === 'speaking'
  return (
    <div className="flex flex-none items-center gap-3 border-b border-line-2 px-3 py-3">
      <div className="h-[38px] w-[38px] flex-none">
        <AvatarBubble name={name} speaking={speaking} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate text-[13.5px]">{name}</p>
        <p className="m-0 flex h-4 items-center gap-2 text-foreground">
          <Waveform bars={14} height={12} animated={speaking} className={cn('transition-opacity', !speaking && 'opacity-25')} />
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{STATE_LABEL[agentState]}</span>
        </p>
      </div>
      <div className="h-[54px] w-[72px] flex-none">
        <CameraTile stream={stream} micOn={micOn} />
      </div>
    </div>
  )
}
