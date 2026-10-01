-- Baseline for the Postgres side of the API.
--
-- Written to be a NO-OP against the database the Spring/Hibernate backend already created
-- (same table/column names), and a full schema on a fresh database:
--   * tables/indexes use IF NOT EXISTS
--   * columns Hibernate's ddl-auto added over time are re-asserted with ADD COLUMN IF NOT EXISTS
--     (only nullable or defaulted ones — safe on populated tables)
--   * the refresh_token FK is added only if that column has no FK yet (Hibernate named it FK...)
-- Legacy tables that moved to MongoDB (candidate_profile, profile_fragment) and the
-- interview_sessions.outcome column are left untouched; drop them after migrate:documents.
CREATE TABLE IF NOT EXISTS "companies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"tier" integer,
	"logo_url" varchar(255),
	"headquarter_location" varchar(255),
	"company_size" varchar(255),
	"created_at" timestamp (6) with time zone NOT NULL,
	CONSTRAINT "companies_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "tier" integer;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "logo_url" varchar(255);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "headquarter_location" varchar(255);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "company_size" varchar(255);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "company_role_configs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company" varchar(255) NOT NULL,
	"role" varchar(255) NOT NULL,
	"level" varchar(16) NOT NULL,
	"jd_title" varchar(255),
	"jd_url" varchar(255),
	"jd_description" text,
	"requirements" text,
	"responsibilities" text,
	"tech_stack" text,
	"round_count" integer,
	"enabled" boolean NOT NULL,
	"created_at" timestamp (6) with time zone NOT NULL,
	CONSTRAINT "uq_company_role_level" UNIQUE("company","role","level")
);
--> statement-breakpoint
ALTER TABLE "company_role_configs" ADD COLUMN IF NOT EXISTS "jd_title" varchar(255);
--> statement-breakpoint
ALTER TABLE "company_role_configs" ADD COLUMN IF NOT EXISTS "jd_url" varchar(255);
--> statement-breakpoint
ALTER TABLE "company_role_configs" ADD COLUMN IF NOT EXISTS "jd_description" text;
--> statement-breakpoint
ALTER TABLE "company_role_configs" ADD COLUMN IF NOT EXISTS "requirements" text;
--> statement-breakpoint
ALTER TABLE "company_role_configs" ADD COLUMN IF NOT EXISTS "responsibilities" text;
--> statement-breakpoint
ALTER TABLE "company_role_configs" ADD COLUMN IF NOT EXISTS "tech_stack" text;
--> statement-breakpoint
ALTER TABLE "company_role_configs" ADD COLUMN IF NOT EXISTS "round_count" integer;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "github_connection" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"github_login" varchar(255) NOT NULL,
	"access_token_enc" varchar(2048) NOT NULL,
	"scope" varchar(255) NOT NULL,
	"connected_at" timestamp (6) with time zone NOT NULL,
	"last_refreshed_at" timestamp (6) with time zone,
	"status" varchar(16),
	CONSTRAINT "github_connection_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "github_connection" ADD COLUMN IF NOT EXISTS "last_refreshed_at" timestamp (6) with time zone;
--> statement-breakpoint
ALTER TABLE "github_connection" ADD COLUMN IF NOT EXISTS "status" varchar(16);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "interview_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"candidate_id" uuid NOT NULL,
	"job_description_id" uuid NOT NULL,
	"company" varchar(255) NOT NULL,
	"role" varchar(255) NOT NULL,
	"level" varchar(16) NOT NULL,
	"specialization" varchar(32),
	"round_type" varchar(32) NOT NULL,
	"scheduled_at" timestamp (6) with time zone NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"status" varchar(24) DEFAULT 'SCHEDULED' NOT NULL,
	"plan_version" varchar(255),
	"input_hash" varchar(255),
	"prep_error" varchar(255),
	"created_at" timestamp (6) with time zone NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL,
	"live_started_at" timestamp (6) with time zone,
	"live_ended_at" timestamp (6) with time zone,
	"ended_reason" varchar(32),
	"livekit_room" varchar(255),
	"live_score_final" double precision,
	"duration_s" integer
);
--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN IF NOT EXISTS "specialization" varchar(32);
--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN IF NOT EXISTS "status" varchar(24) DEFAULT 'SCHEDULED' NOT NULL;
--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN IF NOT EXISTS "plan_version" varchar(255);
--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN IF NOT EXISTS "input_hash" varchar(255);
--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN IF NOT EXISTS "prep_error" varchar(255);
--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN IF NOT EXISTS "live_started_at" timestamp (6) with time zone;
--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN IF NOT EXISTS "live_ended_at" timestamp (6) with time zone;
--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN IF NOT EXISTS "ended_reason" varchar(32);
--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN IF NOT EXISTS "livekit_room" varchar(255);
--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN IF NOT EXISTS "live_score_final" double precision;
--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN IF NOT EXISTS "duration_s" integer;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_descriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"company" varchar(255) NOT NULL,
	"role" varchar(255) NOT NULL,
	"level" varchar(16) NOT NULL,
	"title" varchar(255) NOT NULL,
	"specialization" varchar(32),
	"description" text,
	"tech_stack" text,
	"source_url" varchar(255),
	"source" varchar(16) NOT NULL,
	"active" boolean NOT NULL,
	"created_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_descriptions" ADD COLUMN IF NOT EXISTS "specialization" varchar(32);
--> statement-breakpoint
ALTER TABLE "job_descriptions" ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "job_descriptions" ADD COLUMN IF NOT EXISTS "tech_stack" text;
--> statement-breakpoint
ALTER TABLE "job_descriptions" ADD COLUMN IF NOT EXISTS "source_url" varchar(255);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "leetcode_connection" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"username" varchar(255) NOT NULL,
	"status" varchar(16) NOT NULL,
	"connected_at" timestamp (6) with time zone NOT NULL,
	"last_refreshed_at" timestamp (6) with time zone,
	CONSTRAINT "leetcode_connection_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "leetcode_connection" ADD COLUMN IF NOT EXISTS "last_refreshed_at" timestamp (6) with time zone;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "refresh_token" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp (6) with time zone NOT NULL,
	"revoked_at" timestamp (6) with time zone,
	CONSTRAINT "refresh_token_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "refresh_token" ADD COLUMN IF NOT EXISTS "revoked_at" timestamp (6) with time zone;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"google_sub" varchar(255) NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"role" varchar(16) DEFAULT 'USER' NOT NULL,
	"onboarding_complete" boolean DEFAULT false NOT NULL,
	"created_at" timestamp (6) with time zone NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL,
	CONSTRAINT "app_user_google_sub_unique" UNIQUE("google_sub"),
	CONSTRAINT "app_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "role" varchar(16) DEFAULT 'USER' NOT NULL;
--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "onboarding_complete" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
    WHERE con.conrelid = 'public.refresh_token'::regclass AND con.contype = 'f' AND att.attname = 'user_id'
  ) THEN
    ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_session_candidate" ON "interview_sessions" USING btree ("candidate_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_session_status_scheduled" ON "interview_sessions" USING btree ("status","scheduled_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_jd_company_level" ON "job_descriptions" USING btree ("company","level");
