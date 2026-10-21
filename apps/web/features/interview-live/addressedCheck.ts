/** The interviewer tells talk-to-me from thinking aloud only when the ai-service runs ADDRESSED_CHECK=on. This flag
 * (NEXT_PUBLIC_ADDRESSED_CHECK=on) is flipped together with it: the "think aloud freely" note and the Ask interviewer
 * button promise that behaviour, so they are shown only then. Read at call time (not at import) so tests can stub it. */
export function addressedCheckOn(): boolean {
  return process.env.NEXT_PUBLIC_ADDRESSED_CHECK === 'on'
}
