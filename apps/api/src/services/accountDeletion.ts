import type { AiServiceClient } from "../integrations/aiService/client.js";
import type { GitHubOAuthService } from "../integrations/github/oauth.js";
import { errorMessage } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import { verifyPassword } from "../lib/password.js";
import type {
  CandidateProfileRepository,
  ProfileFragmentRepository,
  BlueprintSeenRepository,
  RoundReportRepository,
  UserPreferencesRepository,
} from "../repositories/mongo.js";
import type { GitHubConnectionRepository, InterviewSessionRepository, UserRepository } from "../repositories/pg.js";
import type { ProfileScoringRepository } from "../repositories/profileScoring.js";
import type { LinkedInImportRepository } from "../repositories/linkedinImports.js";

export class ConfirmationMismatchError extends Error {}
export class InvalidPasswordError extends Error {}
export class InterviewInProgressError extends Error {}
export class DeletionUnavailableError extends Error {}

/** The AI service's purge accepts at most this many session ids per call. */
const PURGE_BATCH = 1000;

export interface AccountDeletionDeps {
  users: UserRepository;
  sessions: InterviewSessionRepository;
  githubConnections: GitHubConnectionRepository;
  candidateProfiles: CandidateProfileRepository;
  fragments: ProfileFragmentRepository;
  seen: BlueprintSeenRepository;
  roundReports: RoundReportRepository;
  preferences: UserPreferencesRepository;
  profileScoring: ProfileScoringRepository;
  linkedinImports?: LinkedInImportRepository;
  aiService: AiServiceClient;
  githubOAuth: GitHubOAuthService;
  log: Logger;
}

/**
 * "Delete account": an immediate hard delete of everything we hold about the user.
 *
 * Order matters:
 *  1. Checks (typed email, password, no live interview). Nothing is touched if any fails.
 *  2. The AI service (interview blueprints and their runs). A failure aborts BEFORE anything local is deleted.
 *  3. The GitHub grant, best effort.
 *  4. The API's Mongo documents.
 *  5. Postgres in one transaction, user row last.
 * Every step is idempotent and the user row goes last, so a crash mid-way leaves an account that
 * can sign in and simply retry.
 */
export class AccountDeletionService {
  constructor(private readonly d: AccountDeletionDeps) {}

  /** False when the user doesn't exist (already deleted). */
  async delete(userId: string, input: { confirmEmail: string; password?: string }): Promise<boolean> {
    const user = await this.d.users.findById(userId);
    if (!user) return false;

    if (input.confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) throw new ConfirmationMismatchError();
    if (user.passwordHash !== null && !(input.password && (await verifyPassword(input.password, user.passwordHash)))) {
      throw new InvalidPasswordError();
    }

    const sessions = await this.d.sessions.findAllByCandidateIdOrderByScheduledAtDesc(userId);
    if (sessions.some((s) => s.status === "LIVE_IN_PROGRESS")) throw new InterviewInProgressError();
    const sessionIds = sessions.map((s) => s.id);

    if (sessionIds.length === 0) {
      // No sessions means no blueprints, only possible admin bench runs (keyed by candidate): purge them,
      // but an AI-service outage must not block deleting an account that never booked an interview.
      try {
        await this.d.aiService.purgeUser(userId, []);
      } catch (err) {
        this.d.log.warn({ err: errorMessage(err) }, `AI service bench-run purge skipped during account deletion userId=${userId}`);
      }
    } else {
      try {
        for (let i = 0; i < sessionIds.length; i += PURGE_BATCH) {
          await this.d.aiService.purgeUser(userId, sessionIds.slice(i, i + PURGE_BATCH));
        }
      } catch (err) {
        this.d.log.warn({ err: errorMessage(err) }, `account deletion aborted: AI service purge failed userId=${userId}`);
        throw new DeletionUnavailableError();
      }
    }

    const github = await this.d.githubConnections.findByUserId(userId);
    if (github) {
      try {
        await this.d.githubOAuth.revokeGrant(github.accessTokenEnc);
      } catch (err) {
        this.d.log.warn({ err: errorMessage(err) }, `GitHub grant revoke failed during account deletion userId=${userId}`);
      }
    }

    const eraseLocal = async () => {
      await Promise.all([
        this.d.candidateProfiles.deleteByUserId(userId),
        this.d.fragments.deleteByUserId(userId),
        this.d.seen.deleteByCandidate(userId),
        this.d.roundReports.deleteByCandidate(userId),
        this.d.preferences.deleteByUserId(userId),
        this.d.profileScoring.deleteByUserId(userId),
        this.d.linkedinImports?.deleteByUserId(userId),
      ]);
      await this.d.users.deleteCascade(userId);
      // A concurrent local scoring read may have started before the first purge. User row is now absent.
      await this.d.profileScoring.deleteByUserId(userId);
      await this.d.linkedinImports?.deleteByUserId(userId);
      await this.d.fragments.deleteByUserIdAndSource(userId, "LINKEDIN");
    };
    // Serialize local deletion with confirm; an in-flight provider read is fenced by epoch removal.
    if (this.d.linkedinImports) await this.d.linkedinImports.withUserLock(userId, eraseLocal);
    else await eraseLocal();
    this.d.log.info(`account deleted userId=${userId}`);
    return true;
  }
}
