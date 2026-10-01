CREATE TABLE "auth_token" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" varchar(32) NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"expires_at" timestamp (6) with time zone NOT NULL,
	"used_at" timestamp (6) with time zone,
	"created_at" timestamp (6) with time zone NOT NULL,
	CONSTRAINT "auth_token_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "app_user" ALTER COLUMN "google_sub" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "password_hash" varchar(255);--> statement-breakpoint
ALTER TABLE "app_user" ADD COLUMN "email_verified_at" timestamp (6) with time zone;--> statement-breakpoint
ALTER TABLE "auth_token" ADD CONSTRAINT "auth_token_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_auth_token_user_purpose" ON "auth_token" USING btree ("user_id","purpose");