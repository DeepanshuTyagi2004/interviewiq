CREATE TABLE "platform_connection" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" varchar(16) NOT NULL,
	"handle" varchar(100) NOT NULL,
	"status" varchar(16) NOT NULL,
	"discovered_from" varchar(16),
	"connected_at" timestamp (6) with time zone NOT NULL,
	"last_refreshed_at" timestamp (6) with time zone,
	CONSTRAINT "uq_platform_connection_user_platform" UNIQUE("user_id","platform")
);
