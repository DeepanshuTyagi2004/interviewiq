'use client'
import { useQuery } from '@tanstack/react-query'
import { getLiveReadiness } from '@/features/interview/api'
import { isMockMode } from './mockMode'

const WAKING_POLL_MS = 3_000
const READY_POLL_MS = 240_000

/** Whether the voice worker is alive. On the dev deployment (Render free) the API and ai-service sleep when idle and the voice worker
 * (LiveKit Cloud) scales to zero: polling wakes the API and ai-service. With a `sessionId` (instructions and device checks) a down
 * worker is also started for that round, so Enter stays disabled until the worker's heartbeat shows it up. Polls every 3 s until ready
 * (an error counts as not ready), then every 4 minutes so the services stay awake for the whole round. Mock mode is always ready. */
export function useInterviewerReadiness(enabled: boolean, sessionId?: string): boolean {
  const mock = isMockMode()
  const { data } = useQuery({
    queryKey: ['interviews', 'live', 'readiness', sessionId ?? null],
    queryFn: () => getLiveReadiness(sessionId),
    enabled: enabled && !mock,
    retry: false,
    refetchIntervalInBackground: true,
    refetchInterval: (query) => (query.state.data?.interviewer === 'ready' && !query.state.error ? READY_POLL_MS : WAKING_POLL_MS),
  })
  return mock || data?.interviewer === 'ready'
}
