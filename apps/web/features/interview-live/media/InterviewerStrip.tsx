'use client'
import { Waveform } from '@/components/visualizations/Waveform'
import { cn } from '@/lib/utils/cn'
import type { AgentState } from '../session/types'
import type { RoomView } from '../workspace/WorkspaceProvider'
import { AvatarBubble } from './AvatarBubble'
import { CameraTile } from './CameraTile'

const STATE_LABEL: Record<AgentState, string> = {
  absent: 'Connecting',
  initializing: 'Joining',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
}

// The same timing as the room's column change, so the tiles grow while the column widens.
const MORPH = 'duration-500 ease-out motion-reduce:transition-none'

/** The top of the conversation column: the interviewer's avatar, waveform and state, and the candidate's camera.
 * `work`: a compact strip with a small self-view. `talk`: two large tiles side by side, like a video call.
 * It is one set of elements in both layouts (only classes change), so the camera video never remounts. */
export function InterviewerStrip({
  name, agentState, stream, micOn, layout,
}: { name: string; agentState: AgentState; stream: MediaStream | null; micOn: boolean; layout: RoomView['layout'] }) {
  const speaking = agentState === 'speaking'
  const talk = layout === 'talk'
  return (
    <div className={cn('flex flex-none transition-[padding,gap]', MORPH, talk ? 'gap-4 px-4 pb-2 pt-5' : 'gap-3 border-b border-line-2 px-3 py-3')}>
      {/* The interviewer: a small avatar beside the name (work), or a big tile with everything centred (talk). */}
      <div className={cn('flex min-w-0 flex-1 items-center', talk ? 'flex-col justify-center gap-3 rounded-[11px] border border-line-2 bg-panel px-3 py-4' : 'gap-3')}>
        <div className={cn('flex-none transition-[width,height]', MORPH, talk ? 'h-[88px] w-[88px]' : 'h-[38px] w-[38px]')}>
          <AvatarBubble
            name={name}
            speaking={speaking}
            className={cn('transition-[box-shadow,font-size]', MORPH, talk && 'text-[34px]')}
          />
        </div>
        <div className={cn('min-w-0', talk ? 'text-center' : 'flex-1')}>
          <p className={cn('m-0 truncate', talk ? 'text-[15px]' : 'text-[13.5px]')}>{name}</p>
          <p className={cn('m-0 flex h-4 items-center gap-2 text-foreground', talk && 'justify-center')}>
            <Waveform bars={14} height={12} animated={speaking} className={cn('transition-opacity', !speaking && 'opacity-25')} />
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{STATE_LABEL[agentState]}</span>
          </p>
        </div>
      </div>
      {/* The candidate: 72x54 (work) or half the column (talk); width and height are animated lengths. */}
      <div className={cn('flex-none transition-[width,height]', MORPH, talk ? 'h-[clamp(176px,24vh,240px)] w-[calc(50%-8px)]' : 'h-[54px] w-[72px]')}>
        <CameraTile stream={stream} micOn={micOn} label={talk ? 'You' : undefined} />
      </div>
    </div>
  )
}
