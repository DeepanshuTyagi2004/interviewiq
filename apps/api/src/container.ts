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
import { LiveKitRoomAdmin, LiveKitTokenService } from "./integrations/livekit.js";
import { BlueprintReconcileJob, EvaluationReconcileJob, GitHubRefreshJob, LeetCodeRefreshJob, PlatformRefreshJob, LiveSessionSweepJob } from "./jobs/jobs.js";
import { AtCoderCollector } from "./integrations/platforms/atcoder.js";
import { CodeChefCollector } from "./integrations/platforms/codechef.js";
import { CodeforcesCollector } from "./integrations/platforms/codeforces.js";
import { PlatformConnectionService } from "./integrations/platforms/service.js";
import { TufCollector } from "./integrations/platforms/tuf.js";
import { BackgroundTasks } from "./lib/background.js";
import { TokenCipher } from "./lib/crypto.js";
import type { FetchLike } from "./lib/http.js";
import type { Logger } from "./lib/logger.js";
import {
  BlueprintSeenRepository,
  RoundReportRepository,
  CandidateProfileRepository,
  ProfileFragmentRepository,
  UserPreferencesRepository,
} from "./repositories/mongo.js";
import {
  CompanyRepository,
  CompanyRoleConfigRepository,
  GitHubConnectionRepository,
  InterviewSessionRepository,
  LoopRepository,
  ProcessRepository,
  TargetRepository,
  JobDescriptionRepository,
  LeetCodeConnectionRepository,
  PlatformConnectionRepository,
  UserRepository,
} from "./repositories/pg.js";
import { CandidateProfileService } from "./services/candidateProfileService.js";
import { CatalogueSeeder } from "./services/catalogueSeeder.js";
import { BlueprintPrepService } from "./services/blueprintPrep.js";
import { RoundEvaluationService } from "./services/roundEvaluation.js";
import { InterviewSessionService } from "./services/interviewSessions.js";
import { LoopService } from "./services/loops.js";
import { InterviewAccess } from "./services/interviewAccess.js";
import { LiveAvailability } from "./services/liveAvailability.js";
import { LiveSessionService } from "./services/liveSessions.js";
import { AccountDeletionService } from "./services/accountDeletion.js";
import { AccountExportService } from "./services/accountExport.js";
import { PreferencesService } from "./services/preferencesService.js";
import { ProfileService } from "./services/profileService.js";
import { UserService } from "./services/userService.js";
import { CompanyEnrichmentService } from "./services/companyEnrichment.js";
import { JdFitService } from "./services/jdFit.js";
import { ProfileScoringRepository } from "./repositories/profileScoring.js";
import { ProfileScoringService } from "./services/profileScoring.js";
import { ProfileScoringJob } from "./jobs/profileScoring.js";
import { LinkedInImportRepository } from "./repositories/linkedinImports.js";
import { LinkedInImportService } from "./services/linkedinImport.js";
import { ValidationControlsRepository } from "./repositories/validationControls.js";
import { CURRENT_SCORING_CONFIG } from "./domain/profileScoring/config.js";

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
    platformConnections: new PlatformConnectionRepository(db),
    sessions: new InterviewSessionRepository(db),
    processes: new ProcessRepository(db),
    loops: new LoopRepository(db),
    targets: new TargetRepository(db),
    candidateProfiles: new CandidateProfileRepository(mongo),
    fragments: new ProfileFragmentRepository(mongo),
    blueprintSeen: new BlueprintSeenRepository(mongo),
    roundReports: new RoundReportRepository(mongo),
    preferences: new UserPreferencesRepository(mongo),
    profileScoring: new ProfileScoringRepository(mongo),
    linkedinImports: new LinkedInImportRepository(mongo),
    validationControls: new ValidationControlsRepository(mongo),
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
    seen: repos.blueprintSeen,
    roundReports: repos.roundReports,
    preferences: repos.preferences,
    profileScoring: repos.profileScoring,
    linkedinImports: repos.linkedinImports,
    aiService,
    githubOAuth,
    log,
  });
  const leetcodeCollector = new LeetCodeCollector(config.leetcode.graphqlUrl, repos.fragments, fetchImpl, log);
  const leetcodeJob = new LeetCodeCollectionJob(repos.leetcodeConnections, leetcodeCollector, log);
  const leetcode = new LeetCodeService(repos.leetcodeConnections, repos.fragments, leetcodeCollector, leetcodeJob, background);
  const p = config.platforms;
  const platforms = new PlatformConnectionService({
    connections: repos.platformConnections, fragments: repos.fragments, background, log,
    collectors: [
      new CodeforcesCollector(p.codeforcesUrl, fetchImpl), new AtCoderCollector(p.atcoderUrl, p.atcoderProblemsUrl, fetchImpl),
      new CodeChefCollector(p.codechefUrl, fetchImpl), new TufCollector(p.tufUrl, p.tufApiUrl, fetchImpl),
    ],
    leetcode: { connections: repos.leetcodeConnections, connect: (userId, username) => leetcode.connect(userId, username) },
  });
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
    repos.profileScoring,
    repos.linkedinImports,
    repos.platformConnections,
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
  const candidateProfiles = new CandidateProfileService(repos.candidateProfiles, repos.users, aiService,
    async (userId) => (await repos.profileScoring.settings(userId)).declaredLevel);
  const linkedin = new LinkedInImportService(repos.linkedinImports, repos.candidateProfiles, repos.fragments, repos.users, aiService, repos.validationControls);
  const profiles = new ProfileService(repos.users, repos.githubConnections, repos.leetcodeConnections, repos.fragments, githubCollector, repos.platformConnections);
  const profileScoring = new ProfileScoringService({
    repo: repos.profileScoring, users: repos.users, profiles: repos.candidateProfiles, fragments: repos.fragments,
    github: repos.githubConnections, leetcode: repos.leetcodeConnections, platforms: repos.platformConnections, preferences, pseudonymKey: config.jwt.secret,
    schedulerEnabled: config.profileScoring.schedulerEnabled, aiService, companies: repos.companies,
    semanticCallsPerBatch: config.profileScoring.semanticCallsPerBatch,
    ...(config.profileScoring.policy === "v5" ? { config: CURRENT_SCORING_CONFIG } : {}),
  });
  const enrichment = new CompanyEnrichmentService(db, aiService);
  const jdFit = new JdFitService({
    jds: repos.jds, companies: repos.companies, profiles: repos.candidateProfiles, fragments: repos.fragments,
    declaredLevel: async (userId) => (await repos.profileScoring.settings(userId)).declaredLevel, enrichment, aiService,
  });
  const blueprintPrep = new BlueprintPrepService({
    sessions: repos.sessions, jds: repos.jds, loops: repos.loops, users: repos.users, candidateProfiles,
    fragments: repos.fragments, seen: repos.blueprintSeen, enrichment, aiService, background, log,
    options: {
      runTimeoutMinutes: config.blueprint.runTimeoutMinutes,
      retryLimitPerHour: config.blueprint.retryLimitPerHour,
      refreshCutoffMinutes: config.blueprint.refreshCutoffMinutes,
    },
  });
  const liveAvailability = new LiveAvailability(config.blueprint.liveInterviewerAvailable);
  const interviewAccess = new InterviewAccess(repos.users);
  const sessions = new InterviewSessionService(repos.sessions, repos.jds, repos.roleConfigs, repos.companies, blueprintPrep, interviewAccess, enrichment,
    repos.loops, liveAvailability);
  const loops = new LoopService(
    repos.processes, repos.loops, repos.targets, repos.sessions, repos.jds, repos.companies, enrichment,
    (company, role, level, specialization) => aiService.fetchBrief(company, role, level, specialization),
  );
  const roundEvaluation = new RoundEvaluationService({
    sessions: repos.sessions, loops: repos.loops, companies: repos.companies, reports: repos.roundReports, seen: repos.blueprintSeen,
    prep: blueprintPrep, aiService, log,
    options: { runTimeoutMinutes: config.evaluation.runTimeoutMinutes, autoRetries: config.evaluation.autoRetries },
  });
  const liveSessions = new LiveSessionService(repos.sessions, liveKit, blueprintPrep, liveAvailability,
    new LiveKitRoomAdmin(config.livekit.url, config.livekit.apiKey, config.livekit.apiSecret, fetchImpl), repos.companies, log,
    roundEvaluation, background, interviewAccess, aiService);
  const seeder = new CatalogueSeeder(repos.roleConfigs, repos.companies, repos.jds, log);

  const jobs = {
    profileScoring: new ProfileScoringJob(profileScoring),
    liveSweep: new LiveSessionSweepJob(repos.sessions, log),
    blueprintReconcile: new BlueprintReconcileJob(repos.sessions, blueprintPrep, {
      refreshEveryTicks: config.blueprint.refreshEveryTicks, refreshCutoffMinutes: config.blueprint.refreshCutoffMinutes,
    }, log),
    evaluationReconcile: new EvaluationReconcileJob(repos.sessions, roundEvaluation, { autoRetries: config.evaluation.autoRetries }, log),
    githubRefresh: new GitHubRefreshJob(repos.githubConnections, profiles, log),
    leetcodeRefresh: new LeetCodeRefreshJob(repos.leetcodeConnections, leetcodeJob, log),
    platformRefresh: new PlatformRefreshJob(repos.platformConnections, platforms, log),
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
    platforms,
    users,
    preferences,
    accountExport,
    accountDeletion,
    passwordAuth,
    rateLimiters,
    candidateProfiles,
    profiles,
    linkedin,
    profileScoring,
    blueprintPrep,
    roundEvaluation,
    enrichment,
    jdFit,
    sessions,
    interviewAccess,
    loops,
    liveSessions,
    seeder,
    jobs,
  };
}

export type Container = ReturnType<typeof createContainer>;
