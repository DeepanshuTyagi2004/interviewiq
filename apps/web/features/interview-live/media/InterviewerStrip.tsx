'use client'
import { Orb, type OrbState } from '@/components/ds'
import { Waveform } from '@/components/visualizations/Waveform'
import { cn } from '@/lib/utils/cn'
import type { CameraStatus } from '../proctor/camera/monitor'
import type { AgentState } from '../session/types'
import type { RoomView } from '../workspace/WorkspaceProvider'
import { CameraTile } from './CameraTile'

const STATE_LABEL: Record<AgentState, string> = {
  absent: 'Connecting',
  initializing: 'Joining',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
}

/** The orb's motion for each agent state (spec §5.5): still while nobody is in the room, breathing while the
 * interviewer joins, then one motion each for listening, thinking and speaking. */
export function agentStateToOrb(s: AgentState): OrbState {
  switch (s) {
    case 'absent': return 'still'
    case 'initializing': return 'breathing'
    case 'listening': return 'listening'
    case 'thinking': return 'thinking'
    case 'speaking': return 'speaking'
  }
}

// The same timing as the room's column change, so the orb grows while the column widens.
const MORPH = 'duration-500 ease-out motion-reduce:transition-none'

/** The top of the conversation column: the interviewer's orb and state, and the candidate's camera.
 * `work`: a compact strip (40 px orb) with a small self-view. `talk`: the orb at 160 px on the stage, with a small
 * rounded self-view in the corner. It is one set of elements in both layouts (only classes change), so the camera
 * video never remounts. */
export function InterviewerStrip({
  name, agentState, stream, micOn, layout, cameraCheck,
}: { name: string; agentState: AgentState; stream: MediaStream | null; micOn: boolean; layout: RoomView['layout']; cameraCheck?: CameraStatus }) {
  const speaking = agentState === 'speaking'
  const talk = layout === 'talk'
  return (
    <div className={cn('relative flex flex-none transition-[padding,gap]', MORPH, talk ? 'flex-col items-center gap-3 px-4 pb-3 pt-8' : 'items-center gap-3 border-b border-line px-3 py-3')}>
      {/* The interviewer: a small orb beside the name (work), or the big orb with everything centred (talk). */}
      <div className={cn('flex min-w-0 items-center', talk ? 'flex-col justify-center gap-4' : 'flex-1 gap-3')}>
        <div data-testid="interviewer-orb" className={cn('flex flex-none items-center justify-center transition-[width,height]', MORPH, talk ? 'h-[160px] w-[160px]' : 'h-[40px] w-[40px]')}>
          <Orb seed={name} size={talk ? 160 : 40} state={agentStateToOrb(agentState)} className="!h-full !w-full" />
        </div>
        <div className={cn('min-w-0', talk ? 'text-center' : 'flex-1')}>
          <p className={cn('m-0 truncate font-display', talk ? 'text-[22px] leading-tight tracking-[-0.02em]' : 'text-[14px] font-medium')} title={name}>{name}</p>
          <p className={cn('m-0 flex h-5 items-center gap-2 text-foreground', talk && 'justify-center')}>
            <Waveform bars={14} height={12} animated={speaking} className={cn('transition-opacity', !speaking && 'opacity-25')} />
            <span className="text-[12.5px] text-ink-3">{STATE_LABEL[agentState]}</span>
          </p>
        </div>
      </div>
      {/* The candidate: 72x54 (work), or a small rounded tile in the corner of the stage (talk). */}
      <div className={cn('flex-none transition-[width,height]', MORPH, talk ? 'absolute right-3 top-3 h-[72px] w-24 sm:right-4 sm:top-4 sm:h-[108px] sm:w-[144px]' : 'h-[54px] w-[72px]')}>
        <CameraTile stream={stream} micOn={micOn} label={talk ? 'You' : undefined} check={cameraCheck} />
      </div>
    </div>
  )
}
