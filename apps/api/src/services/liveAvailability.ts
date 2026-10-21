/**
 * Whether live interviews are open at all: the global LIVE_INTERVIEWER_AVAILABLE switch, off for
 * everyone (admins included) when false. Who may enter is the CANDIDATE/ADMIN role check, not this.
 */
export class LiveAvailability {
  constructor(private readonly globalOn: boolean) {}

  isAvailableFor(_userId: string): boolean {
    return this.globalOn;
  }
}
