'use client'

import { cn } from '@/lib/utils/cn'

interface AvatarBubbleProps {
  name: string
  speaking?: boolean
}

/** The AI interviewer's avatar: the design's monochrome sphere carrying the persona's initial,
 * with a soft brand ring while the interviewer is speaking. Fills its container, so the caller
 * sets the size. */
export function AvatarBubble({ name, speaking = false }: AvatarBubbleProps) {
  const initial = name.charAt(0).toUpperCase()

  return (
    <div
      data-testid="avatar-bubble"
      className={cn(
        'flex h-full w-full items-center justify-center rounded-full text-[13px] font-medium text-white transition-shadow',
        'bg-[radial-gradient(circle_at_35%_30%,hsl(var(--faint-2)),hsl(var(--faint))_40%,hsl(var(--inv))_85%)]',
        speaking && 'ring-4 ring-brand/30'
      )}
    >
      {initial}
    </div>
  )
}
