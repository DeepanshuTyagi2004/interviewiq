'use client'

import { cn } from '@/lib/utils/cn'

interface AvatarBubbleProps {
  name: string
  speaking?: boolean
}

/** Deterministic hue from the name so the same persona always gets the same color
 * (Google-avatar style) instead of a random one that shifts across renders/sessions. */
function hueFromName(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash) % 360
}

/** The AI interviewer's tile: a round avatar showing the persona's initial on a
 * deterministic color, glowing with a ring while the interviewer is speaking. */
export function AvatarBubble({ name, speaking = false }: AvatarBubbleProps) {
  const hue = hueFromName(name)
  const initial = name.charAt(0).toUpperCase()

  return (
    <div
      data-testid="avatar-bubble"
      className={cn(
        'flex h-full w-full items-center justify-center rounded-full text-2xl font-semibold text-white transition-shadow',
        speaking && 'ring-4 ring-primary/60'
      )}
      style={{ backgroundColor: `hsl(${hue}, 65%, 45%)` }}
    >
      {initial}
    </div>
  )
}
