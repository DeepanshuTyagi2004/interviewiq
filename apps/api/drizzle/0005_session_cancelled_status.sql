-- Hibernate created a CHECK on interview_sessions.status that predates CANCELLED. Replace it
-- (IF EXISTS: databases built from the Drizzle baseline never had it).
ALTER TABLE "interview_sessions" DROP CONSTRAINT IF EXISTS "interview_sessions_status_check";--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD CONSTRAINT "interview_sessions_status_check" CHECK ("status" IN ('SCHEDULED','PREP_QUEUED','PREP_READY','PREP_FAILED','LIVE_IN_PROGRESS','COMPLETED','ABORTED_TECHNICAL','CANCELLED'));
