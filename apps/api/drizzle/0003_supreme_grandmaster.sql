CREATE TABLE "company_enrichments" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"document" jsonb NOT NULL,
	"published_document" jsonb,
	"published_revision" integer,
	"published_at" timestamp (6) with time zone,
	"verified_by" uuid
);
--> statement-breakpoint
CREATE TABLE "manual_jd_briefs" (
	"jd_id" uuid PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"brief" jsonb NOT NULL,
	CONSTRAINT "uq_manual_company_role" UNIQUE("company_id","role_id")
);
--> statement-breakpoint
ALTER TABLE "company_enrichments" ADD CONSTRAINT "company_enrichments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_jd_briefs" ADD CONSTRAINT "manual_jd_briefs_jd_id_job_descriptions_id_fk" FOREIGN KEY ("jd_id") REFERENCES "public"."job_descriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_jd_briefs" ADD CONSTRAINT "manual_jd_briefs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;