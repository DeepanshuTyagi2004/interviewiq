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

  // --- interviewiq-ai-service ---
  AI_SERVICE_BASE_URL: withDefault("http://localhost:8000"),
  AI_SERVICE_TIMEOUT_MS: int(120_000),
  /** Shared secret between this API and the AI service (both directions). */
  INTERNAL_API_KEY: required,

  // --- Interview prep (Pipeline 1) trigger ---
  SCHEDULER_ENABLED: bool(true),
  INTERVIEW_PREP_LEAD_TIME_MINUTES: int(15),
  INTERVIEW_PREP_POLL_INTERVAL_MS: int(60_000),
  INTERVIEW_PREP_POLL_INITIAL_DELAY_MS: int(30_000),
  INTERVIEW_PREP_PLAN_POLL_INTERVAL_MS: int(2_000),
  INTERVIEW_PREP_PLAN_MAX_WAIT_MS: int(180_000),

  // --- LiveKit (Pipeline 2 live interview) ---
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
    aiService: { baseUrl: stripTrailingSlash(e.AI_SERVICE_BASE_URL), timeoutMs: e.AI_SERVICE_TIMEOUT_MS },
    internalApiKey: e.INTERNAL_API_KEY,
    interviewPrep: {
      schedulerEnabled: e.SCHEDULER_ENABLED,
      leadTimeMinutes: e.INTERVIEW_PREP_LEAD_TIME_MINUTES,
      pollIntervalMs: e.INTERVIEW_PREP_POLL_INTERVAL_MS,
      pollInitialDelayMs: e.INTERVIEW_PREP_POLL_INITIAL_DELAY_MS,
      planPollIntervalMs: e.INTERVIEW_PREP_PLAN_POLL_INTERVAL_MS,
      planMaxWaitMs: e.INTERVIEW_PREP_PLAN_MAX_WAIT_MS,
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
