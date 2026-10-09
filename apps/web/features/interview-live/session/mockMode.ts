/** Local development only: NEXT_PUBLIC_LIVE_MOCK=1 runs the room against the scripted interviewer,
 * with no API or LiveKit. Never on in production builds. */
export function isMockMode(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_LIVE_MOCK === '1'
}
