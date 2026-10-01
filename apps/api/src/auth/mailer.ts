import type { Logger } from "../lib/logger.js";

/** One transactional auth email. `link` carries a raw single-use token. */
export interface AuthEmail {
  to: string;
  name: string;
  link: string;
}

/**
 * Outbound auth email. Wired in the container (`ContainerDeps.mailer`) so a real provider can be
 * swapped in later without touching the auth flow; tests inject a capturing fake.
 */
export interface Mailer {
  sendVerificationEmail(email: AuthEmail): Promise<void>;
  sendPasswordResetEmail(email: AuthEmail): Promise<void>;
}

/**
 * Dev/POC mailer: "sends" by logging the link at info level.
 *
 * SECURITY: this is the ONE place in the API where a raw token is allowed to reach the logs —
 * the link IS the email until a real provider exists. Anyone who can read these logs can verify
 * or reset any account that requests a link, so replace this before real users sign up.
 */
export class ConsoleMailer implements Mailer {
  constructor(private readonly log: Logger) {}

  async sendVerificationEmail({ to, link }: AuthEmail): Promise<void> {
    this.log.info(`[dev-mail] Verify your email for ${to}: ${link}`);
  }

  async sendPasswordResetEmail({ to, link }: AuthEmail): Promise<void> {
    this.log.info(`[dev-mail] Reset your password for ${to}: ${link}`);
  }
}
