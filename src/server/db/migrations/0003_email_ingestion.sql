CREATE TABLE "email_imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"storage_key" text,
	"filename" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"scanned" integer DEFAULT 0 NOT NULL,
	"relevant" integer DEFAULT 0 NOT NULL,
	"imported" integer DEFAULT 0 NOT NULL,
	"duplicates" integer DEFAULT 0 NOT NULL,
	"limit_reached" boolean DEFAULT false NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "inbound_addresses" ADD COLUMN "verification_code" text;--> statement-breakpoint
ALTER TABLE "inbound_addresses" ADD COLUMN "verification_link" text;--> statement-breakpoint
ALTER TABLE "inbound_addresses" ADD COLUMN "verification_received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inbound_addresses" ADD COLUMN "last_received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD COLUMN "from_domain" text;--> statement-breakpoint
ALTER TABLE "inbound_messages" ADD COLUMN "source" text DEFAULT 'email_forward' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_imports" ADD CONSTRAINT "email_imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_imports_user_idx" ON "email_imports" USING btree ("user_id","created_at");