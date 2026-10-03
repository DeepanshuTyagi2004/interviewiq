import { EmailTokenService } from "./auth/emailTokens.js";
import { GoogleOAuthService } from "./auth/googleOAuth.js";
import { JwtService } from "./auth/jwt.js";
import { ConsoleMailer, type Mailer } from "./auth/mailer.js";
import { PasswordAuthService } from "./auth/passwordAuth.js";
import { RefreshTokenService } from "./auth/refreshTokens.js";
import type { Config } from "./config.js";
import type { MongoCollections } from "./db/mongo/client.js";
import type { Database } from "./db/pg/client.js";
import { type AuthRateLimits, createAuthRateLimiters, DEFAULT_AUTH_RATE_LIMITS } from "./http/rateLimit.js";
import { AiServiceClient } from "./integrations/aiService/client.js";
import { GitHubCollector } from "./integrations/github/collector.js";
import { GitHubOAuthService } from "./integrations/github/oauth.js";
import { OAuthStateService } from "./integrations/github/oauthState.js";
import { LeetCodeCollector } from "./integrations/leetcode/collector.js";
import { LeetCodeCollectionJob, LeetCodeService } from "./integrations/leetcode/service.js";
import { LiveKitTokenService } from "./integrations/livekit.js";
import { GitHubRefreshJob, InterviewPrepJob, LeetCodeRefreshJob } from "./jobs/jobs.js";
import { BackgroundTasks } from "./lib/background.js";
import { TokenCipher } from "./lib/crypto.js";
import type { FetchLike } from "./lib/http.js";
import type { Logger } from "./lib/logger.js";
import {
  CandidateProfileRepository,
  ProfileFragmentRepository,
  SessionOutcomeRepository,
  UserPreferencesRepository,
} from "./repositories/mongo.js";
import {
  CompanyRepository,
  CompanyRoleConfigRepository,
  GitHubConnectionRepository,
  InterviewSessionRepository,
  JobDescriptionRepository,
  LeetCodeConnectionRepository,
  UserRepository,
} from "./repositories/pg.js";
import { CandidateProfileService } from "./services/candidateProfileService.js";
import { CatalogueSeeder } from "./services/catalogueSeeder.js";
import { CodingSignalsProvider } from "./services/codingSignals.js";
import { InterviewPrepService } from "./services/interviewPrep.js";
import { InterviewSessionService } from "./services/interviewSessions.js";
import { LiveSessionService } from "./services/liveSessions.js";
import { AccountDeletionService } from "./services/accountDeletion.js";
import { AccountExportService } from "./services/accountExport.js";
import { PreferencesService } from "./services/preferencesService.js";
import { ProfileService } from "./services/profileService.js";
import { UserService } from "./services/userService.js";
import { CompanyEnrichmentService } from "./services/companyEnrichment.js";

export interface ContainerDeps {
  config: Config;
  log: Logger;
  db: Database;
  mongo: MongoCollections;
  /** Outbound HTTP — injectable so tests can stub the AI service, GitHub, LeetCode and Google. */
  fetch?: FetchLike;
  /** Auth email delivery (verify / reset links). Defaults to ConsoleMailer until a provider exists. */
  mailer?: Mailer;
  /** Override the auth endpoints' rate limits (tests use tiny or huge ones). */
  authRateLimits?: Partial<AuthRateLimits>;
}

/** Composition root: wires every repository, integration and service (what Spring DI did). */
export function createContainer({ config, log, db, mongo, fetch: fetchImpl = globalThis.fetch, mailer, authRateLimits }: ContainerDeps) {
  const background = new BackgroundTasks(log);

  const repos = {
    users: new UserRepository(db),
    companies: new CompanyRepository(db),
    roleConfigs: new CompanyRoleConfigRepository(db),
    jds: new JobDescriptionRepository(db),
    githubConnections: new GitHubConnectionRepository(db),
    leetcodeConnections: new LeetCodeConnectionRepository(db),
    sessions: new InterviewSessionRepository(db),
    candidateProfiles: new CandidateProfileRepository(mongo),
    fragments: new ProfileFragmentRepository(mongo),
    outcomes: new SessionOutcomeRepository(mongo),
    preferences: new UserPreferencesRepository(mongo),
  };

  const jwt = new JwtService(config.jwt.secret, config.jwt.accessTokenMinutes);
  const refreshTokens = new RefreshTokenService(db, jwt, config.refreshTokenDays);
  const googleOAuth = new GoogleOAuthService(config.google, fetchImpl);
  const tokenCipher = new TokenCipher(config.github.tokenKey);

  const aiService = new AiServiceClient(config.aiService.baseUrl, config.internalApiKey, fetchImpl, log, config.aiService.timeoutMs);
  const githubCollector = new GitHubCollector(config.github.graphqlUrl, tokenCipher, repos.fragments, fetchImpl);
  const githubOAuth = new GitHubOAuthService(config.github, new OAuthStateService(config.jwt.secret), tokenCipher, repos.githubConnections, fetchImpl);
  const accountDeletion = new AccountDeletionService({
    users: repos.users,
    sessions: repos.sessions,
    githubConnections: repos.githubConnections,
    candidateProfiles: repos.candidateProfiles,
    fragments: repos.fragments,
    outcomes: repos.outcomes,
    preferences: repos.preferences,
    aiService,
    githubOAuth,
    log,
  });
  const leetcodeCollector = new LeetCodeCollector(config.leetcode.graphqlUrl, repos.fragments, fetchImpl, log);
  const leetcodeJob = new LeetCodeCollectionJob(repos.leetcodeConnections, leetcodeCollector, log);
  const leetcode = new LeetCodeService(repos.leetcodeConnections, repos.fragments, leetcodeCollector, leetcodeJob, background);
  const liveKit = new LiveKitTokenService(config.livekit.url, config.livekit.apiKey, config.livekit.apiSecret);

  const users = new UserService(db, repos.users, config.adminEmails);
  const preferences = new PreferencesService(repos.preferences);
  const accountExport = new AccountExportService(
    repos.users,
    preferences,
    repos.candidateProfiles,
    repos.githubConnections,
    repos.leetcodeConnections,
    repos.fragments,
    repos.sessions,
    repos.outcomes,
  );
  if (!mailer && config.env === "production") {
    log.warn("ConsoleMailer is active: email verification and password-reset links are written to the logs");
  }
  const passwordAuth = new PasswordAuthService(
    db,
    users,
    new EmailTokenService(db),
    refreshTokens,
    jwt,
    mailer ?? new ConsoleMailer(log),
    background,
    log,
    config.frontendUrl,
  );
  const rateLimiters = createAuthRateLimiters({ ...DEFAULT_AUTH_RATE_LIMITS, ...authRateLimits });
  const candidateProfiles = new CandidateProfileService(repos.candidateProfiles, repos.users, aiService);
  const codingSignals = new CodingSignalsProvider(repos.fragments);
  const profiles = new ProfileService(repos.users, repos.githubConnections, repos.leetcodeConnections, repos.fragments, githubCollector);
  const enrichment = new CompanyEnrichmentService(db, aiService);
  const prep = new InterviewPrepService(repos.sessions, repos.jds, candidateProfiles, codingSignals, aiService, background, log, {
    planPollIntervalMs: config.interviewPrep.planPollIntervalMs,
    planMaxWaitMs: config.interviewPrep.planMaxWaitMs,
  }, enrichment);
  const sessions = new InterviewSessionService(repos.sessions, repos.jds, repos.roleConfigs, repos.companies, prep, enrichment);
  const liveSessions = new LiveSessionService(repos.sessions, repos.outcomes, liveKit);
  const seeder = new CatalogueSeeder(repos.roleConfigs, repos.companies, repos.jds, log);

  const jobs = {
    interviewPrep: new InterviewPrepJob(repos.sessions, prep, config.interviewPrep.leadTimeMinutes, log),
    githubRefresh: new GitHubRefreshJob(repos.githubConnections, profiles, log),
    leetcodeRefresh: new LeetCodeRefreshJob(repos.leetcodeConnections, leetcodeJob, log),
  };

  return {
    config,
    log,
    background,
    repos,
    jwt,
    refreshTokens,
    googleOAuth,
    aiService,
    githubOAuth,
    leetcode,
    users,
    preferences,
    accountExport,
    accountDeletion,
    passwordAuth,
    rateLimiters,
    candidateProfiles,
    codingSignals,
    profiles,
    prep,
    enrichment,
    sessions,
    liveSessions,
    seeder,
    jobs,
  };
}

export type Container = ReturnType<typeof createContainer>;
