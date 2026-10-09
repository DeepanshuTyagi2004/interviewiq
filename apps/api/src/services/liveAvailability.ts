/**
 * Who may enter a live interview (spec §8.1): everyone once LIVE_INTERVIEWER_AVAILABLE is on;
 * until then only the user ids in LIVE_INTERVIEWER_ALLOWLIST (the proof-of-concept test account).
 */
export class LiveAvailability {
  private readonly allow: Set<string>;

  constructor(
    private readonly globalOn: boolean,
    allowlist: readonly string[] = [],
  ) {
    this.allow = new Set(allowlist.map((id) => id.trim()).filter(Boolean));
  }

  isAvailableFor(userId: string): boolean {
    return this.globalOn || this.allow.has(userId);
  }
}
