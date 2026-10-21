import { z } from "zod";

/**
 * All configuration comes from the environment (a local `.env` is loaded by the npm scripts via
 * `--env-file-if-exists`). Required values fail fast at startup, exactly like the Spring app did for
 * unresolved `${...}` placeholders.
 */

const emptyToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

const required = z.preprocess(emptyToUndefined, z.string({ error: "is required" }));
const optional = z.preprocess(emptyToUndefined, z.string().optional());
const withDefault = (def: string) => z.preprocess(emptyToUndefined, z.string().default(def));
const int = (def: number) => z.preprocess(emptyToUndefined, z.coerce.number().int().nonnegative().default(def));
const bool = (def: boolean) =>
  z.preprocess(emptyToUndefined, z.enum(["true", "false"]).default(def ? "true" : "false")).transform((v) => v === "true");

const envSchema = z.object({
  NODE_ENV: withDefault("development"),
  PORT: int(8080),
  LOG_LEVEL: withDefault("info"),
  LOG_PRETTY: z.preprocess(emptyToUndefined, z.enum(["true", "false"]).optional()),

  /** Public origin of this API — used to build OAuth redirect URIs (Google + GitHub). */
  API_PUBLIC_URL: withDefault("http://localhost:8080"),
  /** Frontend origin: CORS allow-origin + post-login redirect target. */
  FRONTEND_URL: withDefault("http://localhost:3000"),
  FRONTEND_CONNECTIONS_REDIRECT: optional,
  /** Mark auth cookies `Secure` (set true behind HTTPS in production). */
  COOKIE_SECURE: bool(false),
  /** SameSite for the refresh cookie. Use `none` (+ COOKIE_SECURE=true) when web and API are on different sites. */
  COOKIE_SAME_SITE: z.preprocess(emptyToUndefined, z.enum(["lax", "strict", "none"]).default("lax")),

  // --- Postgres (Supabase in production, local container in dev) ---
  DATABASE_URL: required,
  /** auto | disable | require | verify-full. `auto` honours ?sslmode= in the URL, else requires TLS for *.supabase.co/com hosts. */
  DATABASE_SSL: z.preprocess(emptyToUndefined, z.enum(["auto", "disable", "require", "verify-full"]).default("auto")),
  /** Optional PEM file with the CA (e.g. Supabase's) for DATABASE_SSL=verify-full. */
  DATABASE_SSL_CA: optional,
  DATABASE_POOL_MAX: int(10),
  /** Apply pending Drizzle migrations at startup (replaces Hibernate ddl-auto=update). */
  DATABASE_MIGRATE_ON_START: bool(true),

  // --- MongoDB (Atlas in production, local container in dev) ---
  MONGODB_URI: required,
  MONGODB_DATABASE: withDefault("interviewiq"),

  // --- Auth ---
  GOOGLE_CLIENT_ID: required,
  GOOGLE_CLIENT_SECRET: required,
  JWT_SECRET: required.refine((s) => Buffer.byteLength(s, "utf8") >= 32, {
    message: "must be at least 32 bytes (HS256 needs a 256-bit key)",
  }),
  ACCESS_TOKEN_MINUTES: int(15),
  REFRESH_TOKEN_DAYS: int(14),
  /** Comma-separated emails auto-promoted to ADMIN on Google login. */
  ADMIN_EMAILS: withDefault(""),

  // --- GitHub Profile Builder ---
  GITHUB_OAUTH_CLIENT_ID: required,
  GITHUB_OAUTH_CLIENT_SECRET: required,
  GITHUB_OAUTH_SCOPE: withDefault("read:user"),
  GITHUB_OAUTH_AUTHORIZE_URL: withDefault("https://github.com/login/oauth/authorize"),
  GITHUB_OAUTH_TOKEN_URL: withDefault("https://github.com/login/oauth/access_token"),
  GITHUB_OAUTH_CALLBACK_URL: optional,
  GITHUB_API_URL: withDefault("https://api.github.com"),
  GITHUB_GRAPHQL_URL: withDefault("https://api.github.com/graphql"),
  /** AES-256-GCM key (base64 of 32 bytes) for encrypting stored GitHub tokens. */
  GITHUB_TOKEN_KEY: required,

  // --- LeetCode Profile Builder ---
  LEETCODE_GRAPHQL_URL: withDefault("https://leetcode.com/graphql"),

  // --- Coding platforms (public profile data; docs/sources/platform-analyzers.md) ---
  CODEFORCES_URL: withDefault("https://codeforces.com"),
  ATCODER_URL: withDefault("https://atcoder.jp"),
  ATCODER_PROBLEMS_URL: withDefault("https://kenkoooo.com/atcoder"),
  CODECHEF_URL: withDefault("https://www.codechef.com"),
  TUF_URL: withDefault("https://takeuforward.org"),
  TUF_API_URL: withDefault("https://backend-go.takeuforward.org"),

  // --- interviewiq-ai-service ---
  AI_SERVICE_BASE_URL: withDefault("http://localhost:8000"),
  AI_SERVICE_TIMEOUT_MS: int(120_000),
  /** Shared secret between this API and the AI service (both directions). */
  INTERNAL_API_KEY: required,

  // --- Schedulers: blueprint prep reconcile + weekly source refreshes ---
  SCHEDULER_ENABLED: bool(true),
  /** Independent local-only beta profile scoring: startup catch-up, then hourly UTC calendar-week polling. */
  PROFILE_SCORING_SCHEDULER_ENABLED: bool(true),
  /** Keep legacy v4 as the safe default; set v5 to activate enhanced CP/internship scoring. */
  // v5 (AI item assessment, platform-relative CP, open source) is the current policy; v4 only for replay.
  PROFILE_SCORING_POLICY: z.preprocess(emptyToUndefined, z.enum(["v4", "v5"]).default("v5")),
  /** v5 only: maximum LLM calls one scoring batch may spend on semantic item assessment. */
  PROFILE_SCORING_SEMANTIC_CALLS_PER_BATCH: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(100_000).default(200)),
  // --- Interview blueprint prep (docs/superpowers/specs/2026-10-07-interview-blueprint-design.md §5.4) ---
  BLUEPRINT_RECONCILE_INTERVAL_MS: int(60_000),
  BLUEPRINT_REFRESH_EVERY_TICKS: int(15),
  BLUEPRINT_REFRESH_CUTOFF_MINUTES: int(30),
  BLUEPRINT_RUN_TIMEOUT_MINUTES: int(17), // a little above the AI service's BLUEPRINT_RUN_TIMEOUT_SECONDS (900)
  BLUEPRINT_RETRY_LIMIT_PER_HOUR: int(3),
  // --- Round evaluation (docs/superpowers/specs/2026-10-18-post-interview-report-design.md §11.1) ---
  EVALUATION_RECONCILE_INTERVAL_MS: int(60_000),
  EVALUATION_RUN_TIMEOUT_MINUTES: int(20),
  /** Automatic re-runs after a transient failure, per rolling hour. */
  EVALUATION_AUTO_RETRIES: int(2),
  /** Off until the live interviewer is rebuilt on the blueprint: ready sessions can't be joined. */
  LIVE_INTERVIEWER_AVAILABLE: bool(false),
  /** Comma-separated user ids that may go live while LIVE_INTERVIEWER_AVAILABLE is off (the POC test account). */
  LIVE_INTERVIEWER_ALLOWLIST: withDefault(""),

  // --- LiveKit (live interview rooms) ---
  LIVEKIT_URL: withDefault("ws://localhost:7880"),
  LIVEKIT_API_KEY: required,
  LIVEKIT_API_SECRET: required,
});

export type Config = ReturnType<typeof toConfig>;

function toConfig(e: z.infer<typeof envSchema>) {
  const frontendUrl = stripTrailingSlash(e.FRONTEND_URL);
  const apiPublicUrl = stripTrailingSlash(e.API_PUBLIC_URL);
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    log: { level: e.LOG_LEVEL, pretty: e.LOG_PRETTY ? e.LOG_PRETTY === "true" : e.NODE_ENV !== "production" },
    apiPublicUrl,
    frontendUrl,
    connectionsRedirect: e.FRONTEND_CONNECTIONS_REDIRECT ?? `${frontendUrl}/connections`,
    cookieSecure: e.COOKIE_SECURE,
    cookieSameSite: e.COOKIE_SAME_SITE,
    postgres: {
      url: e.DATABASE_URL,
      ssl: e.DATABASE_SSL,
      sslCaFile: e.DATABASE_SSL_CA,
      poolMax: e.DATABASE_POOL_MAX,
      migrateOnStart: e.DATABASE_MIGRATE_ON_START,
    },
    mongo: { uri: e.MONGODB_URI, database: e.MONGODB_DATABASE },
    google: { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET, redirectUri: `${apiPublicUrl}/login/oauth2/code/google` },
    jwt: { secret: e.JWT_SECRET, accessTokenMinutes: e.ACCESS_TOKEN_MINUTES },
    refreshTokenDays: e.REFRESH_TOKEN_DAYS,
    adminEmails: e.ADMIN_EMAILS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    github: {
      clientId: e.GITHUB_OAUTH_CLIENT_ID,
      clientSecret: e.GITHUB_OAUTH_CLIENT_SECRET,
      scope: e.GITHUB_OAUTH_SCOPE,
      authorizeUrl: e.GITHUB_OAUTH_AUTHORIZE_URL,
      tokenUrl: e.GITHUB_OAUTH_TOKEN_URL,
      callbackUrl: e.GITHUB_OAUTH_CALLBACK_URL ?? `${apiPublicUrl}/api/v1/connections/github/callback`,
      apiUrl: stripTrailingSlash(e.GITHUB_API_URL),
      graphqlUrl: e.GITHUB_GRAPHQL_URL,
      tokenKey: e.GITHUB_TOKEN_KEY,
    },
    leetcode: { graphqlUrl: e.LEETCODE_GRAPHQL_URL },
    platforms: {
      codeforcesUrl: stripTrailingSlash(e.CODEFORCES_URL), atcoderUrl: stripTrailingSlash(e.ATCODER_URL), atcoderProblemsUrl: stripTrailingSlash(e.ATCODER_PROBLEMS_URL),
      codechefUrl: stripTrailingSlash(e.CODECHEF_URL), tufUrl: stripTrailingSlash(e.TUF_URL), tufApiUrl: stripTrailingSlash(e.TUF_API_URL),
    },
    aiService: { baseUrl: stripTrailingSlash(e.AI_SERVICE_BASE_URL), timeoutMs: e.AI_SERVICE_TIMEOUT_MS },
    internalApiKey: e.INTERNAL_API_KEY,
     profileScoring: { schedulerEnabled: e.PROFILE_SCORING_SCHEDULER_ENABLED, policy: e.PROFILE_SCORING_POLICY, semanticCallsPerBatch: e.PROFILE_SCORING_SEMANTIC_CALLS_PER_BATCH },
    schedulerEnabled: e.SCHEDULER_ENABLED,
    blueprint: {
      reconcileIntervalMs: e.BLUEPRINT_RECONCILE_INTERVAL_MS,
      refreshEveryTicks: Math.max(1, e.BLUEPRINT_REFRESH_EVERY_TICKS),
      refreshCutoffMinutes: e.BLUEPRINT_REFRESH_CUTOFF_MINUTES,
      runTimeoutMinutes: e.BLUEPRINT_RUN_TIMEOUT_MINUTES,
      retryLimitPerHour: e.BLUEPRINT_RETRY_LIMIT_PER_HOUR,
      liveInterviewerAvailable: e.LIVE_INTERVIEWER_AVAILABLE,
      liveInterviewerAllowlist: e.LIVE_INTERVIEWER_ALLOWLIST.split(",").map((s) => s.trim()).filter(Boolean),
    },
    evaluation: {
      reconcileIntervalMs: e.EVALUATION_RECONCILE_INTERVAL_MS,
      runTimeoutMinutes: e.EVALUATION_RUN_TIMEOUT_MINUTES,
      autoRetries: e.EVALUATION_AUTO_RETRIES,
    },
    livekit: { url: e.LIVEKIT_URL, apiKey: e.LIVEKIT_API_KEY, apiSecret: e.LIVEKIT_API_SECRET },
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  return toConfig(parsed.data);
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
