ALTER TABLE "email_connections" ADD COLUMN "access_token_enc" "bytea";--> statement-breakpoint
ALTER TABLE "email_connections" ADD COLUMN "access_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_connections" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "email_connections" ADD COLUMN "imported" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Scheduler: ids of connections to sync (cross-user scan returns ids only).
CREATE OR REPLACE FUNCTION app_active_email_connections() RETURNS TABLE(id uuid, user_id uuid) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT c.id, c.user_id FROM email_connections c WHERE c.status = 'active' $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_active_email_connections() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_active_email_connections() TO lifeos_app;
