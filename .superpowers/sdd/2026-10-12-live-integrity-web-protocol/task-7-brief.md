### Task 7: The countdown bar and the foreign-paste action in the room

**Files:**
- Create: `apps/web/features/interview-live/proctor/ProctorContext.tsx`
- Test: `apps/web/features/interview-live/proctor/ProctorBars.test.tsx`, `ProctorContext.test.tsx`
- Modify: `apps/web/features/interview-live/proctor/ProctorBars.tsx`, `apps/web/app/(app)/interviews/[sessionId]/live/_components/LiveView.tsx`

**Interfaces:**
- Consumes: `AwayEpisode`, `useAwayCountdown` (Task 6); `ForeignInsert`, `attachRoomCopyGuard` (Task 3); `clipboardRulesActive`, `forgetBuffer` (Task 2).
- Produces: `ProctorActions { foreignPaste(info: ForeignInsert): void }`, `ProctorActionsProvider`, `useProctorActions(): ProctorActions` (a no-op default outside the room); `ProctorBars` gains an optional `away?: AwayEpisode | null` prop.

- [ ] **Step 1: Write the failing tests**

Create `ProctorBars.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import type { AwayEpisode } from './awayEpisode'
import { ProctorBars } from './ProctorBars'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('ProctorBars return clock', () => {
  it('counts down to the limit, then to the end of the interview', () => {
    const away: AwayEpisode = { startedAt: Date.now(), kinds: ['tab_hidden'], tight: true }
    render(<ProctorBars outOfFullscreen={false} shareStopped={false} toast={null} away={away} />)
    expect(screen.getByText(/Return to the interview within 15 s/)).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(20_000) })
    expect(screen.getByText(/Return now\. The interview ends in 40 s/)).toBeInTheDocument()
  })

  it('says nothing about time while the candidate is on the screen', () => {
    render(<ProctorBars outOfFullscreen={false} shareStopped={false} toast={null} away={null} />)
    expect(screen.queryByText(/Return/)).toBeNull()
  })

  it('still shows the return-to-full-screen bar beside the countdown', () => {
    const away: AwayEpisode = { startedAt: Date.now(), kinds: ['fullscreen_exit'], tight: false }
    render(<ProctorBars outOfFullscreen shareStopped={false} toast={null} away={away} />)
    expect(screen.getByRole('button', { name: 'Return to full screen' })).toBeInTheDocument()
    expect(screen.getByText(/within 30 s/)).toBeInTheDocument()
  })
})
```

Create `ProctorContext.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { ProctorActionsProvider, useProctorActions } from './ProctorContext'

describe('useProctorActions', () => {
  it('is a harmless no-op outside the live room', () => {
    const { result } = renderHook(() => useProctorActions())
    expect(() => result.current.foreignPaste({ source: 'paste', chars: 1, lines: 1 })).not.toThrow()
  })

  it('hands the room its actions', () => {
    const foreignPaste = vi.fn()
    const { result } = renderHook(() => useProctorActions(), {
      wrapper: ({ children }) => <ProctorActionsProvider value={{ foreignPaste }}>{children}</ProctorActionsProvider>,
    })
    result.current.foreignPaste({ source: 'drop', chars: 5, lines: 1 })
    expect(foreignPaste).toHaveBeenCalledWith({ source: 'drop', chars: 5, lines: 1 })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail** (when the user has said to run tests)

Run (from `apps/web`): `pnpm exec vitest run features/interview-live/proctor/ProctorBars.test.tsx features/interview-live/proctor/ProctorContext.test.tsx`
Expected: FAIL (no `away` prop; module not found).

- [ ] **Step 3: Write `ProctorContext.tsx`**

```tsx
'use client'
import { createContext, useContext } from 'react'
import type { ForeignInsert } from './editorClipboard'

/** What the room's panes can tell the proctor: the editor reports text that came from outside the room. */
export interface ProctorActions {
  foreignPaste(info: ForeignInsert): void
}

const Ctx = createContext<ProctorActions>({ foreignPaste: () => {} })

export const ProctorActionsProvider = Ctx.Provider

export function useProctorActions(): ProctorActions {
  return useContext(Ctx)
}
```

- [ ] **Step 4: Add the countdown to `ProctorBars.tsx`**

Add the imports:

```tsx
import type { AwayEpisode } from './awayEpisode'
import { useAwayCountdown } from './useAwayCountdown'
```

Add `away = null` to the props destructuring and the prop type (`away?: AwayEpisode | null`), call `const clock = useAwayCountdown(away)` next to the `shareError` state, and render this just before the `{outOfFullscreen ? (` block:

```tsx
      {clock ? (
        <div role="status" className="flex flex-none items-center gap-3 border-b border-line-2 bg-panel px-4 py-2 text-[13px]">
          <StatusDot state="warn" srLabel="Warning" />
          <span className="min-w-0 flex-1">
            {clock.phase === 'limit'
              ? `Return to the interview within ${clock.seconds} s. After that it counts as another violation.`
              : `Return now. The interview ends in ${clock.seconds} s.`}
          </span>
        </div>
      ) : null}
```

Update the doc comment of `ProctorBars` to end: "…and a countdown while the candidate is away. The round keeps running."

- [ ] **Step 5: Wire `LiveView.tsx`**

Add imports:

```tsx
import { useEffect, useMemo } from 'react'
import { attachRoomCopyGuard } from '@/features/interview-live/proctor/editorClipboard'
import { clipboardRulesActive, forgetBuffer } from '@/features/interview-live/proctor/localClipboard'
import { ProctorActionsProvider } from '@/features/interview-live/proctor/ProctorContext'
```

After `const proctor = useProctor({ session, enabled: true })` add:

```tsx
  const proctorActions = useMemo(() => ({ foreignPaste: proctor.foreignPaste }), [proctor.foreignPaste])
  // Copy and cut anywhere in the room stay in the room (the editor guards its own); only while the clipboard rules are on.
  useEffect(() => {
    if (!clipboardRulesActive()) return
    const detach = attachRoomCopyGuard(document)
    return () => {
      detach()
      forgetBuffer()
    }
  }, [])
```

Wrap the returned tree: the outermost element becomes `<ProctorActionsProvider value={proctorActions}>…</ProctorActionsProvider>` around the existing `<ActivityProvider …>…</ActivityProvider>`, and pass the episode to the bars:

```tsx
          <ProctorBars outOfFullscreen={proctor.outOfFullscreen} shareStopped={proctor.shareStopped} toast={proctor.toast} away={proctor.away} presence={presence} />
```

- [ ] **Step 6: Run the tests to verify they pass** (when the user has said to run tests)

Run (from `apps/web`): `pnpm exec vitest run features/interview-live/proctor "app/(app)/interviews/[sessionId]/live/_components/LiveView.test.tsx"`
Expected: PASS (the existing `LiveView` tests still pass: the clipboard rules are off under test, so the room guard is not attached).

- [ ] **Step 7: Leave the files in the working tree** (no commit): `ProctorContext.tsx`, `ProctorBars.tsx`, `LiveView.tsx`, and the two new test files.

---
