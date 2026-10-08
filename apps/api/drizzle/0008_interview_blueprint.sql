-- Additive only (apps/api/CLAUDE.md): the old plan columns (plan_version, input_hash, prep_error) stay in
-- the table unused; the blueprint prep state lives in the new columns below.
ALTER TABLE "interview_sessions" ADD COLUMN "prep_run_id" varchar(64);--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "prep_run_started_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "prep_input_hash" varchar(128);--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "blueprint_version" integer;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "prep_error_code" varchar(64);--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "prep_refreshing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "prep_retry_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "prep_retry_window_start" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "prepared_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "prep_briefing" jsonb;--> statement-breakpoint
UPDATE "interview_sessions" SET "status" = 'PREP_QUEUED' WHERE "status" IN ('PREP_READY', 'PREP_FAILED') AND "scheduled_at" > now();
