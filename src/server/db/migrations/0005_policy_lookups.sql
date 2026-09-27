CREATE TABLE "policy_lookups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"subject" text NOT NULL,
	"category" text NOT NULL,
	"status" text NOT NULL,
	"result" jsonb,
	"model" text,
	"searches" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "item_facts" ADD COLUMN "source_url" text;--> statement-breakpoint
CREATE UNIQUE INDEX "policy_lookups_key_uidx" ON "policy_lookups" USING btree ("key");--> statement-breakpoint
CREATE INDEX "policy_lookups_checked_idx" ON "policy_lookups" USING btree ("checked_at");--> statement-breakpoint
-- Shared, user-free cache: readable/writable by the app role, no RLS (no user data).
GRANT SELECT, INSERT, UPDATE, DELETE ON "policy_lookups" TO lifeos_app;
