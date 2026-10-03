CREATE TABLE "interview_processes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"jd_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"graph" jsonb NOT NULL,
	"created_at" timestamp (6) with time zone NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loops" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"jd_id" uuid NOT NULL,
	"process_id" uuid,
	"kind" varchar(16) NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"graph" jsonb NOT NULL,
	"confirmed_at" timestamp (6) with time zone NOT NULL,
	"created_at" timestamp (6) with time zone NOT NULL,
	"updated_at" timestamp (6) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "targets" (
	"user_id" uuid NOT NULL,
	"jd_id" uuid NOT NULL,
	"created_at" timestamp (6) with time zone NOT NULL,
	CONSTRAINT "targets_user_id_jd_id_pk" PRIMARY KEY("user_id","jd_id")
);
--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "loop_id" uuid;--> statement-breakpoint
ALTER TABLE "interview_sessions" ADD COLUMN "node_id" varchar(64);--> statement-breakpoint
ALTER TABLE "interview_processes" ADD CONSTRAINT "interview_processes_jd_id_job_descriptions_id_fk" FOREIGN KEY ("jd_id") REFERENCES "public"."job_descriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loops" ADD CONSTRAINT "loops_jd_id_job_descriptions_id_fk" FOREIGN KEY ("jd_id") REFERENCES "public"."job_descriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loops" ADD CONSTRAINT "loops_process_id_interview_processes_id_fk" FOREIGN KEY ("process_id") REFERENCES "public"."interview_processes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "targets" ADD CONSTRAINT "targets_jd_id_job_descriptions_id_fk" FOREIGN KEY ("jd_id") REFERENCES "public"."job_descriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_process_user" ON "interview_processes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_loop_user" ON "loops" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_loop_live" ON "loops" USING btree ("user_id","jd_id") WHERE status in ('active','paused');--> statement-breakpoint
CREATE INDEX "idx_session_loop" ON "interview_sessions" USING btree ("loop_id");