import { randomUUID } from "node:crypto";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { CODING_PLATFORMS, ROLES, ROUND_TYPES, SESSION_STATUSES, SYNC_STATUSES } from "../../domain/enums.js";
import type { EnrichmentDocument, EnrichmentBrief } from "../../domain/enrichment.js";
import type { ProcessGraph } from "../../domain/process.js";

/**
 * Relational data in Postgres (Supabase in production).
 *
 * Table and column names are EXACTLY the ones Hibernate created for the Spring backend, so this
 * API runs against the existing database unchanged. Ids are app-generated UUIDs (Hibernate had no
 * DB-side defaults), and created/updated timestamps are stamped by the app like @PrePersist did.
 *
 * Document-shaped data lives in MongoDB instead (see ../mongo): candidate profiles, profile
 * fragments, and live-session outcomes.
 */

const id = () =>
  uuid("id")
    .primaryKey()
    .$defaultFn(() => randomUUID());

const instant = (name: string) => timestamp(name, { withTimezone: true, precision: 6, mode: "date" });
const createdAt = () =>
  instant("created_at")
    .notNull()
    .$defaultFn(() => new Date());
const updatedAt = () =>
  instant("updated_at")
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());

export const users = pgTable("app_user", {
  id: id(),
  /** Google subject. Null for email/password-only accounts (unique, so many NULLs are allowed). */
  googleSub: varchar("google_sub", { length: 255 }).unique(),
  /**
   * Unique as stored. Password sign-ups store it lowercased; Google rows keep Google's spelling, so
   * lookups by email are case-insensitive (`lower(email)`).
   */
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  role: varchar("role", { length: 16, enum: ROLES }).notNull().default("USER"),
  /** True once the onboarding wizard is finished. Gates app entry vs /onboarding. */
  onboardingComplete: boolean("onboarding_complete").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  /** Self-describing scrypt hash (`scrypt$N$r$p$salt$hash`, see lib/password.ts). Null = no password (Google-only). NEVER logged or returned. */
  passwordHash: varchar("password_hash", { length: 255 }),
  /** When the user proved control of `email` (verify link, reset link, or Google's email_verified). */
  emailVerifiedAt: instant("email_verified_at"),
});

export const refreshTokens = pgTable("refresh_token", {
  id: id(),
  tokenHash: varchar("token_hash", { length: 128 }).notNull().unique(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  expiresAt: instant("expires_at").notNull(),
  revokedAt: instant("revoked_at"),
});

export const AUTH_TOKEN_PURPOSES = ["verify_email", "reset_password"] as const;
export type AuthTokenPurpose = (typeof AUTH_TOKEN_PURPOSES)[number];

/**
 * Single-use email tokens (verify email, reset password). Like refresh tokens, only the SHA-256
 * hash of the raw token is stored; the raw value exists only in the emailed link.
 */
export const authTokens = pgTable(
  "auth_token",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    purpose: varchar("purpose", { length: 32, enum: AUTH_TOKEN_PURPOSES }).notNull(),
    tokenHash: varchar("token_hash", { length: 128 }).notNull().unique(),
    expiresAt: instant("expires_at").notNull(),
    usedAt: instant("used_at"),
    createdAt: createdAt(),
  },
  (t) => [index("idx_auth_token_user_purpose").on(t.userId, t.purpose)],
);

export const COMPANY_STATUSES = ["active", "archived"] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];
export const COMPANY_ORIGINS = ["seed", "admin"] as const;
export type CompanyOrigin = (typeof COMPANY_ORIGINS)[number];

/** A short attributed quote from a public review, shown to students with its link (spec §4.1). */
export interface ReviewQuote {
  text: string;
  sourceUrl: string;
  sourceName: string | null;
  date: string | null;
}

/**
 * A company students can target. `slug` joins to JDs, role configs and the AI-service brief keys.
 * Students only ever see rows with `publishedAt` set and `status = active` (spec §4.1); everything
 * below `companySize` is written only when an admin approves a research draft (Phase 2+).
 */
export const companies = pgTable("companies", {
  id: id(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 255 }).notNull().unique(),
  /** Placement tier 1-4 (pay band + selectivity, spec §6.4); descriptive metadata only. */
  tier: integer("tier"),
  logoUrl: varchar("logo_url", { length: 255 }),
  headquarterLocation: varchar("headquarter_location", { length: 255 }),
  companySize: varchar("company_size", { length: 255 }),
  createdAt: createdAt(),
  website: varchar("website", { length: 255 }),
  aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
  sector: varchar("sector", { length: 64 }),
  businessModel: varchar("business_model", { length: 16 }),
  /** Admin override of the code standard graded in mock rounds (runnable | near_runnable | pseudo_ok); null derives it from tier + business model. */
  codeStandard: varchar("code_standard", { length: 16 }),
  headcountBand: varchar("headcount_band", { length: 32 }),
  revenueBand: varchar("revenue_band", { length: 32 }),
  fundingStage: varchar("funding_stage", { length: 32 }),
  tierRationale: text("tier_rationale"),
  wlbRating: numeric("wlb_rating", { precision: 2, scale: 1 }),
  wlbReviewCount: integer("wlb_review_count"),
  reviewSummary: text("review_summary"),
  reviewQuotes: jsonb("review_quotes").$type<ReviewQuote[]>().notNull().default([]),
  status: varchar("status", { length: 16, enum: COMPANY_STATUSES }).notNull().default("active"),
  origin: varchar("origin", { length: 16, enum: COMPANY_ORIGINS }).notNull().default("admin"),
  publishedVersion: integer("published_version"),
  publishedAt: instant("published_at"),
});

/**
 * One company + role + level brief-generation key. `level` is fresher/sde1/sde2/sde3, kept as a
 * free string so the catalogue can evolve without a code change.
 */
export const companyRoleConfigs = pgTable(
  "company_role_configs",
  {
    id: id(),
    company: varchar("company", { length: 255 }).notNull(),
    role: varchar("role", { length: 255 }).notNull(),
    level: varchar("level", { length: 16 }).notNull(),
    title: varchar("jd_title", { length: 255 }),
    jdUrl: varchar("jd_url", { length: 255 }),
    jdDescription: text("jd_description"),
    requirements: text("requirements"),
    responsibilities: text("responsibilities"),
    /** Comma-separated. */
    techStack: text("tech_stack"),
    roundCount: integer("round_count"),
    /** Toggle a combination off without deleting it. */
    enabled: boolean("enabled").notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique("uq_company_role_level").on(t.company, t.role, t.level)],
);

/**
 * A specific job posting a student can browse and book against. MANY per company+level; the
 * interview process comes from the brief keyed by (company, role, level, specialization).
 */
export const jobDescriptions = pgTable(
  "job_descriptions",
  {
    id: id(),
    company: varchar("company", { length: 255 }).notNull(),
    role: varchar("role", { length: 255 }).notNull(),
    level: varchar("level", { length: 16 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    specialization: varchar("specialization", { length: 32 }),
    description: text("description"),
    /** Comma-separated. */
    techStack: text("tech_stack"),
    sourceUrl: varchar("source_url", { length: 255 }),
    /** "seed" — currently the only source. */
    source: varchar("source", { length: 16 }).notNull(),
    active: boolean("active").notNull(),
    /** Research-derived role facts (spec §4.1), written on draft approval (Phase 3). */
    yoeMin: numeric("yoe_min", { precision: 3, scale: 1 }),
    yoeMax: numeric("yoe_max", { precision: 3, scale: 1 }),
    ctcMinLpa: numeric("ctc_min_lpa", { precision: 6, scale: 2 }),
    ctcMaxLpa: numeric("ctc_max_lpa", { precision: 6, scale: 2 }),
    ctcSourceCount: integer("ctc_source_count"),
    /** Stable role identity across research runs: slug(level + specialization + title). */
    roleKey: varchar("role_key", { length: 128 }),
    createdAt: createdAt(),
  },
  (t) => [index("idx_jd_company_level").on(t.company, t.level), unique("uq_jd_company_role_key").on(t.company, t.roleKey)],
);

/** Authoritative admin draft and human-verified publication, atomically versioned in Postgres. */
export const companyEnrichments = pgTable("company_enrichments", {
  companyId: uuid("company_id").primaryKey().references(() => companies.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull().default(0),
  document: jsonb("document").$type<EnrichmentDocument>().notNull(),
  publishedDocument: jsonb("published_document").$type<EnrichmentDocument>(),
  publishedRevision: integer("published_revision"),
  publishedAt: instant("published_at"),
  verifiedBy: uuid("verified_by"),
});

/** Retained for archived JDs so existing booked sessions can still prepare. */
export const manualJdBriefs = pgTable("manual_jd_briefs", {
  jdId: uuid("jd_id").primaryKey().references(() => jobDescriptions.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  roleId: uuid("role_id").notNull(),
  brief: jsonb("brief").$type<EnrichmentBrief>().notNull(),
}, (t) => [unique("uq_manual_company_role").on(t.companyId, t.roleId)]);

export const githubConnections = pgTable("github_connection", {
  id: id(),
  userId: uuid("user_id").notNull().unique(),
  githubLogin: varchar("github_login", { length: 255 }).notNull(),
  /** AES-256-GCM ciphertext (base64). NEVER logged, NEVER exposed in a response. */
  accessTokenEnc: varchar("access_token_enc", { length: 2048 }).notNull(),
  scope: varchar("scope", { length: 255 }).notNull(),
  connectedAt: instant("connected_at")
    .notNull()
    .$defaultFn(() => new Date()),
  lastRefreshedAt: instant("last_refreshed_at"),
  /** Nullable: rows created before this column existed have no status. */
  status: varchar("status", { length: 16, enum: SYNC_STATUSES }).$defaultFn(() => "SYNCED"),
});

/** LeetCode: public profiles queried by username — no OAuth, no token. */
export const leetcodeConnections = pgTable("leetcode_connection", {
  id: id(),
  userId: uuid("user_id").notNull().unique(),
  username: varchar("username", { length: 255 }).notNull(),
  status: varchar("status", { length: 16, enum: SYNC_STATUSES }).notNull(),
  connectedAt: instant("connected_at")
    .notNull()
    .$defaultFn(() => new Date()),
  lastRefreshedAt: instant("last_refreshed_at"),
});

/**
 * One handle-based coding-platform connection (Codeforces, CodeChef, AtCoder, TUF) per
 * user and platform. `discoveredFrom` records an automatic connection made from another profile's
 * linked accounts (e.g. "TUF"); a connection the user made themselves has null.
 */
export const platformConnections = pgTable(
  "platform_connection",
  {
    id: id(),
    userId: uuid("user_id").notNull(),
    platform: varchar("platform", { length: 16, enum: CODING_PLATFORMS }).notNull(),
    handle: varchar("handle", { length: 100 }).notNull(),
    status: varchar("status", { length: 16, enum: SYNC_STATUSES }).notNull(),
    discoveredFrom: varchar("discovered_from", { length: 16 }),
    connectedAt: instant("connected_at")
      .notNull()
      .$defaultFn(() => new Date()),
    lastRefreshedAt: instant("last_refreshed_at"),
  },
  (t) => [unique("uq_platform_connection_user_platform").on(t.userId, t.platform)],
);

/**
 * A booked mock-interview session: blueprint prep (docs/superpowers/specs/2026-10-07-interview-blueprint-design.md)
 * + live runtime. company/role/level/specialization are copied from the JD at booking time. The blueprint itself
 * lives in the AI service; the session keeps its version, fingerprint and the candidate-safe briefing.
 */
/** The live round's proctoring and conduct summary, written when it ends (spec §8.2). */
export interface LiveSummary {
  tab_changes: number;
  screen_changes_weighted: number;
  full_violations: number;
  conduct_incidents: number;
  ended_at?: string;
  interviewer_note?: string;
}

export const interviewSessions = pgTable(
  "interview_sessions",
  {
    id: id(),
    candidateId: uuid("candidate_id").notNull(),
    jobDescriptionId: uuid("job_description_id"),
    company: varchar("company", { length: 255 }).notNull(),
    role: varchar("role", { length: 255 }).notNull(),
    level: varchar("level", { length: 64 }).notNull(),
    specialization: varchar("specialization", { length: 32 }),
    roundType: varchar("round_type", { length: 32, enum: ROUND_TYPES }).notNull(),
    /** The chosen slot as an absolute instant; `timezone` records what the user booked in. */
    scheduledAt: instant("scheduled_at").notNull(),
    timezone: varchar("timezone", { length: 64 }).notNull(),
    status: varchar("status", { length: 24, enum: SESSION_STATUSES }).notNull().default("SCHEDULED"),
    /** The active blueprint run in the AI service (first prep, retry or refresh); null when none is running. */
    prepRunId: varchar("prep_run_id", { length: 64 }),
    prepRunStartedAt: instant("prep_run_started_at"),
    /** Input fingerprint of the current blueprint (spec §5.1); a different one triggers a refresh. */
    prepInputHash: varchar("prep_input_hash", { length: 128 }),
    blueprintVersion: integer("blueprint_version"),
    /** Stable error code when status == PREP_FAILED. */
    prepErrorCode: varchar("prep_error_code", { length: 64 }),
    /** A refresh run is active; the current blueprint stays live until it succeeds. */
    prepRefreshing: boolean("prep_refreshing").notNull().default(false),
    prepRetryCount: integer("prep_retry_count").notNull().default(0),
    prepRetryWindowStart: instant("prep_retry_window_start"),
    preparedAt: instant("prepared_at"),
    /** The blueprint's candidate-safe briefing: interviewer, format, duration. Never topics or problems. */
    prepBriefing: jsonb("prep_briefing").$type<{ interviewer_name: string; interviewer_style: string; format: string; duration_mins: number }>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    liveStartedAt: instant("live_started_at"),
    liveEndedAt: instant("live_ended_at"),
    endedReason: varchar("ended_reason", { length: 32 }),
    liveSummary: jsonb("live_summary").$type<LiveSummary>(),
    livekitRoom: varchar("livekit_room", { length: 255 }),
    liveScoreFinal: doublePrecision("live_score_final"),
    durationS: integer("duration_s"),
    /** The loop (confirmed per-JD process) and graph node this session is a round of; null for ad-hoc bookings. */
    loopId: uuid("loop_id"),
    nodeId: varchar("node_id", { length: 64 }),
    practicePrep: jsonb("practice_prep").$type<import("../../domain/practice.js").PracticePrepSnapshot>(),
    /** This round's length (30/35/40/45), drawn at booking and kept through reschedules; null (read as 45) for sessions booked before the draw. */
    roundMinutes: integer("round_minutes"),
    /** Booking snapshot (spec §8.5): the stored values always win over a later recomputation. */
    passMark: numeric("pass_mark", { precision: 3, scale: 1, mode: "number" }),
    codeStandard: varchar("code_standard", { length: 16 }),
    companyTier: smallint("company_tier"),
    roundDifficulty: varchar("round_difficulty", { length: 8 }),
    /** pending | running | ready | failed | unscorable | legacy; null before the round ends. */
    evalStatus: varchar("eval_status", { length: 16 }),
    evalRunId: varchar("eval_run_id", { length: 64 }),
    evalRunStartedAt: instant("eval_run_started_at"),
    evalAttempts: integer("eval_attempts").notNull().default(0),
    evalRetryWindowStart: instant("eval_retry_window_start"),
    evalErrorCode: varchar("eval_error_code", { length: 64 }),
    score: numeric("score", { precision: 3, scale: 1, mode: "number" }),
    outcome: varchar("eval_outcome", { length: 16 }).$type<import("../../domain/evaluation.js").EvalOutcome>(),
    verdict: varchar("verdict", { length: 24 }),
    retakeAfter: instant("retake_after"),
    evalVersion: varchar("eval_version", { length: 16 }),
    evaluatedAt: instant("evaluated_at"),
  },
  (t) => [
    index("idx_session_candidate").on(t.candidateId),
    index("idx_session_eval_status").on(t.evalStatus),
    // Drives the blueprint reconcile job: sessions by status and slot.
    index("idx_session_status_scheduled").on(t.status, t.scheduledAt),
    index("idx_session_loop").on(t.loopId),
  ],
);

/** A user's saved custom process (a graph of runnable rounds), optionally copied from a JD. */
export const interviewProcesses = pgTable(
  "interview_processes",
  {
    id: id(),
    userId: uuid("user_id").notNull(),
    jdId: uuid("jd_id").references(() => jobDescriptions.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    level: varchar("level", { length: 64 }).notNull().default("custom"),
    graph: jsonb("graph").$type<ProcessGraph>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_process_user").on(t.userId)],
);

export const LOOP_KINDS = ["official", "standalone"] as const;
export const LOOP_STATUSES = ["active", "paused", "abandoned", "completed"] as const;

/**
 * A confirmed process, optionally associated with a JD. `graph` is a snapshot taken at confirm time, so later edits to the
 * saved process never change a running loop. Only `official` loops count toward readiness.
 */
export const loops = pgTable(
  "loops",
  {
    id: id(),
    userId: uuid("user_id").notNull(),
    jdId: uuid("jd_id").references(() => jobDescriptions.id, { onDelete: "cascade" }),
    processId: uuid("process_id").references(() => interviewProcesses.id, { onDelete: "set null" }),
    name: varchar("name", { length: 120 }).notNull().default("Custom practice"),
    level: varchar("level", { length: 64 }).notNull().default("custom"),
    kind: varchar("kind", { length: 16, enum: LOOP_KINDS }).notNull(),
    status: varchar("status", { length: 16, enum: LOOP_STATUSES }).notNull().default("active"),
    graph: jsonb("graph").$type<ProcessGraph>().notNull(),
    confirmedAt: instant("confirmed_at").notNull().$defaultFn(() => new Date()),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("idx_loop_user").on(t.userId),
    // One live loop per user and JD; finished/abandoned loops stay as history.
    uniqueIndex("uq_loop_live").on(t.userId, t.jdId).where(sql`status in ('active','paused')`),
  ],
);

/** JDs a user is eyeing but has not confirmed a loop for. */
export const targets = pgTable(
  "targets",
  {
    userId: uuid("user_id").notNull(),
    jdId: uuid("jd_id").notNull().references(() => jobDescriptions.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.jdId] })],
);

export type LoopRow = typeof loops.$inferSelect;
export type InterviewProcessRow = typeof interviewProcesses.$inferSelect;
export type TargetRow = typeof targets.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type RefreshTokenRow = typeof refreshTokens.$inferSelect;
export type AuthTokenRow = typeof authTokens.$inferSelect;
export type CompanyRow = typeof companies.$inferSelect;
export type CompanyRoleConfigRow = typeof companyRoleConfigs.$inferSelect;
export type JobDescriptionRow = typeof jobDescriptions.$inferSelect;
export type GitHubConnectionRow = typeof githubConnections.$inferSelect;
export type LeetCodeConnectionRow = typeof leetcodeConnections.$inferSelect;
export type PlatformConnectionRow = typeof platformConnections.$inferSelect;
export type InterviewSessionRow = typeof interviewSessions.$inferSelect;
