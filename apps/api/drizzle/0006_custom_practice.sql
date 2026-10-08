ALTER TABLE "interview_processes" ALTER COLUMN "jd_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_sessions" ALTER COLUMN "job_description_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_sessions" ALTER COLUMN "level" SET DATA TYPE varchar(64);--> statement-breakpoint
ALTER TABLE "loops" ALTER COLUMN "jd_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_processes" ADD COLUMN "level" varchar(64) DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "practice_prep" jsonb;--> statement-breakpoint
ALTER TABLE "loops" ADD COLUMN "name" varchar(120) DEFAULT 'Custom practice' NOT NULL;--> statement-breakpoint
ALTER TABLE "loops" ADD COLUMN "level" varchar(64) DEFAULT 'custom' NOT NULL;--> statement-breakpoint
UPDATE "interview_processes" p SET "level" = j."level" FROM "job_descriptions" j WHERE p."jd_id" = j."id";--> statement-breakpoint
UPDATE "loops" l SET "name" = COALESCE((SELECT p."name" FROM "interview_processes" p WHERE p."id" = l."process_id"), LEFT(j."title", 120)), "level" = j."level" FROM "job_descriptions" j WHERE l."jd_id" = j."id";
