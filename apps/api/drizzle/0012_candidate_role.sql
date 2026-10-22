-- Hibernate created a CHECK on app_user.role that predates CANDIDATE. Replace it
-- (IF EXISTS: databases built from the Drizzle baseline never had it).
ALTER TABLE "app_user" DROP CONSTRAINT IF EXISTS "app_user_role_check";--> statement-breakpoint
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_role_check" CHECK ("role" IN ('USER','CANDIDATE','ADMIN'));
