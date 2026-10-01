import type { AuthEmail, Mailer } from "../../src/auth/mailer.js";

export interface SentMail extends AuthEmail {
  kind: "verify" | "reset";
}

/** Captures auth emails instead of logging them, so tests can pull the link/token out. */
export class FakeMailer implements Mailer {
  readonly sent: SentMail[] = [];
  /** Make the next sends fail (to exercise delivery-error handling). */
  failNext = 0;

  async sendVerificationEmail(email: AuthEmail): Promise<void> {
    this.record({ ...email, kind: "verify" });
  }

  async sendPasswordResetEmail(email: AuthEmail): Promise<void> {
    this.record({ ...email, kind: "reset" });
  }

  /** Mails of `kind` sent to `to` (exact match), oldest first. */
  to(to: string, kind?: SentMail["kind"]): SentMail[] {
    return this.sent.filter((m) => m.to === to && (!kind || m.kind === kind));
  }

  /** The raw token in the most recent `kind` mail to `to`. Throws if there is none. */
  lastToken(to: string, kind: SentMail["kind"]): string {
    const mail = this.to(to, kind).at(-1);
    if (!mail) throw new Error(`no ${kind} mail sent to ${to}`);
    const token = new URL(mail.link).searchParams.get("token");
    if (!token) throw new Error(`mail link has no token: ${mail.link}`);
    return token;
  }

  private record(mail: SentMail): void {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error(`provider rejected ${mail.to}`);
    }
    this.sent.push(mail);
  }
}
