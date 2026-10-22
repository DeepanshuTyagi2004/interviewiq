'use client'
import { useQuery } from '@tanstack/react-query'
import { getLiveReadiness } from '@/features/interview/api'
import { isMockMode } from './mockMode'

const WAKING_POLL_MS = 3_000
const READY_POLL_MS = 240_000

/** Whether the interviewer stack (API, ai-service and the in-container voice worker) is awake.
 * On the dev deployment (Render free) those services sleep when idle: polling this endpoint wakes the API and, through it,
 * the ai-service and the voice worker. Polls every 3 s until ready (an error counts as not ready), then every 4 minutes
 * so they stay awake for the whole round. Mock mode is always ready and never queries. */
export function useInterviewerReadiness(enabled: boolean): boolean {
  const mock = isMockMode()
  const { data } = useQuery({
    queryKey: ['interviews', 'live', 'readiness'],
    queryFn: getLiveReadiness,
    enabled: enabled && !mock,
    retry: false,
    refetchIntervalInBackground: true,
    refetchInterval: (query) => (query.state.data?.interviewer === 'ready' && !query.state.error ? READY_POLL_MS : WAKING_POLL_MS),
  })
  return mock || data?.interviewer === 'ready'
}
