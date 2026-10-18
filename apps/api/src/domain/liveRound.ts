/**
 * A mock round is 30, 35, 40 or 45 minutes, drawn at booking (decided 2026-10-18; it was always 45 since 2026-10-09). The researched
 * real-round length does not decide it. `MOCK_ROUND_MINUTES` is the maximum and the length of sessions booked before the draw existed.
 */
export const MOCK_ROUND_MINUTES = 45;
export const MOCK_ROUND_MIN_MINUTES = 30;
export const ROUND_MINUTE_CHOICES = [30, 35, 40, 45] as const;

/** A uniform draw over the four lengths; `rand` is injectable so tests can pin every outcome. */
export function drawRoundMinutes(rand: () => number = Math.random): number {
  const i = Math.min(ROUND_MINUTE_CHOICES.length - 1, Math.max(0, Math.floor(rand() * ROUND_MINUTE_CHOICES.length)));
  return ROUND_MINUTE_CHOICES[i]!;
}

/** The session's own length; a session booked before the draw existed has none stored and keeps 45. */
export function sessionRoundMinutes(s: { roundMinutes: number | null }): number {
  return s.roundMinutes ?? MOCK_ROUND_MINUTES;
}
