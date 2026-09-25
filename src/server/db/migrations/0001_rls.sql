-- Row-level security: defense in depth under the repository layer.
-- The runtime role `lifeos_app` is not a superuser, does not own these tables and
-- has no BYPASSRLS, so a query that forgets `WHERE user_id = …` returns nothing
-- instead of another user's rows. `withUser()` sets app.user_id per transaction.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'lifeos_app') THEN
    CREATE ROLE lifeos_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO lifeos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lifeos_app;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "categories" FROM lifeos_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "documents_owner" ON "documents" USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE "document_extractions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "document_extractions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "document_extractions_owner" ON "document_extractions" USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE "items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "items" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "items_owner" ON "items" USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE "item_categories" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "item_categories" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "item_categories_owner" ON "item_categories" USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE "item_facts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "item_facts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "item_facts_owner" ON "item_facts" USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE "purchases" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "purchases" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "purchases_owner" ON "purchases" USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "subscriptions_owner" ON "subscriptions" USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE "warranties" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "warranties" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "warranties_owner" ON "warranties" USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE "travel_credits" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "travel_credits" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "travel_credits_owner" ON "travel_credits" USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE "protections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "protections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "protections_owner" ON "protections" USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE "financial_outcomes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "financial_outcomes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "financial_outcomes_owner" ON "financial_outcomes" USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE "actions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "actions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "actions_owner" ON "actions" USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE "reminders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "reminders" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "reminders_owner" ON "reminders" USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "notifications_owner" ON "notifications" USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notification_preferences" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "notification_preferences_owner" ON "notification_preferences" USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "audit_events_owner" ON "audit_events" USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE "inbound_addresses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inbound_addresses" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "inbound_addresses_owner" ON "inbound_addresses" USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE "email_connections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "email_connections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "email_connections_owner" ON "email_connections" USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE "inbound_messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inbound_messages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "inbound_messages_owner" ON "inbound_messages" USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id());
--> statement-breakpoint
-- Cross-user scans the worker needs. SECURITY DEFINER (owned by the migration role)
-- returning only ids; the worker then processes each row inside withUser().
CREATE OR REPLACE FUNCTION app_due_reminders(p_limit integer)
  RETURNS TABLE (id uuid, user_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT r.id, r.user_id FROM reminders r
        WHERE r.status = 'scheduled' AND r.remind_at <= now()
        ORDER BY r.remind_at LIMIT p_limit $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_users_with_open_actions()
  RETURNS TABLE (user_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT DISTINCT a.user_id FROM actions a WHERE a.status IN ('open', 'snoozed') $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_due_reminders(integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_users_with_open_actions() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_due_reminders(integer) TO lifeos_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_users_with_open_actions() TO lifeos_app;
--> statement-breakpoint
INSERT INTO "categories" (id, slug, name, sort_order) VALUES
  (gen_random_uuid(), 'purchases', 'Purchases', 1),
  (gen_random_uuid(), 'returns', 'Returns', 2),
  (gen_random_uuid(), 'warranties', 'Warranties', 3),
  (gen_random_uuid(), 'subscriptions', 'Subscriptions', 4),
  (gen_random_uuid(), 'travel', 'Travel', 5),
  (gen_random_uuid(), 'bills', 'Bills', 6),
  (gen_random_uuid(), 'documents', 'Documents', 7),
  (gen_random_uuid(), 'renewals', 'Renewals', 8),
  (gen_random_uuid(), 'appointments', 'Appointments', 9),
  (gen_random_uuid(), 'other', 'Other', 10)
ON CONFLICT (slug) DO NOTHING;
