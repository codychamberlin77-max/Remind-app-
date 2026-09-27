ALTER TABLE "email_imports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "email_imports" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "email_imports_owner" ON "email_imports" USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "email_imports" TO lifeos_app;
--> statement-breakpoint
-- The inbound email webhook has no session: resolve the forwarding token to its
-- owner with a SECURITY DEFINER lookup that returns only the user id.
CREATE OR REPLACE FUNCTION app_inbound_user(p_token text)
  RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT a.user_id FROM inbound_addresses a WHERE a.token = lower(p_token) AND a.disabled_at IS NULL LIMIT 1 $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_inbound_user(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_inbound_user(text) TO lifeos_app;
