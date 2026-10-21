ALTER TABLE "companies" ADD COLUMN "code_standard" varchar(16);--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "pass_mark" numeric(3, 1);--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "code_standard" varchar(16);--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "company_tier" smallint;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "round_difficulty" varchar(8);--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "eval_status" varchar(16);--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "eval_run_id" varchar(64);--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "eval_run_started_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "eval_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "eval_retry_window_start" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "eval_error_code" varchar(64);--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "score" numeric(3, 1);--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "eval_outcome" varchar(16);--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "verdict" varchar(24);--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "retake_after" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "eval_version" varchar(16);--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "evaluated_at" timestamp (6) with time zone;--> statement-breakpoint
CREATE INDEX "idx_session_eval_status" ON "interview_sessions" USING btree ("eval_status");--> statement-breakpoint
UPDATE "interview_sessions" SET "eval_status" = 'legacy' WHERE "status" = 'COMPLETED';
