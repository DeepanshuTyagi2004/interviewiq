ALTER TABLE "companies" ADD COLUMN "website" varchar(255);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "aliases" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "sector" varchar(64);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "business_model" varchar(16);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "headcount_band" varchar(32);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "revenue_band" varchar(32);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "funding_stage" varchar(32);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "tier_rationale" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "wlb_rating" numeric(2, 1);--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "wlb_review_count" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "review_summary" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "review_quotes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "status" varchar(16) DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "origin" varchar(16) DEFAULT 'admin' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "published_version" integer;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "published_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "job_descriptions" ADD COLUMN "yoe_min" numeric(3, 1);--> statement-breakpoint
ALTER TABLE "job_descriptions" ADD COLUMN "yoe_max" numeric(3, 1);--> statement-breakpoint
ALTER TABLE "job_descriptions" ADD COLUMN "ctc_min_lpa" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "job_descriptions" ADD COLUMN "ctc_max_lpa" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "job_descriptions" ADD COLUMN "ctc_source_count" integer;--> statement-breakpoint
ALTER TABLE "job_descriptions" ADD COLUMN "role_key" varchar(128);--> statement-breakpoint
ALTER TABLE "job_descriptions" ADD CONSTRAINT "uq_jd_company_role_key" UNIQUE("company","role_key");
--> statement-breakpoint
-- Companies created before research existed were seeded and already visible to students: keep
-- them visible (published) and mark where they came from.
UPDATE "companies" SET "published_at" = "created_at", "origin" = 'seed' WHERE "published_at" IS NULL;
