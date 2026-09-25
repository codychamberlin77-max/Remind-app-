/**
 * LIFEOS database schema.
 *
 * Conventions
 * - UUIDv7 primary keys (non-enumerable, time-ordered).
 * - Money is integer cents + ISO currency code.
 * - Calendar deadlines are `date` (YYYY-MM-DD strings), never timestamps.
 * - Every user-owned table carries `user_id` → users ON DELETE CASCADE, an index
 *   leading with user_id, and a row-level-security policy (see migrations/*_rls.sql).
 * - Enumerations are text columns constrained by TypeScript unions + Zod at the
 *   boundary, so adding a new kind never needs a Postgres enum migration.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";
import type {
  ActionStatus,
  ActionType,
  Basis,
  Certainty,
  Consequence,
  DocumentSource,
  DocumentStage,
  DocumentStatus,
  ItemKind,
  ItemState,
  OutcomeKind,
  ProtectionKind,
  ProtectionStatus,
  ReminderChannel,
  ReminderPreset,
  ReminderStatus,
} from "@/server/domain/types";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

const id = () => uuid("id").primaryKey().$defaultFn(() => uuidv7());
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const userRef = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });

// ───────────────────────────── Auth (Better Auth) ─────────────────────────────
// These four tables are read by Better Auth before a user context exists, so
// they are NOT under RLS; the app role never queries them outside auth code.

export const users = pgTable("users", {
  id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  timezone: text("timezone").notNull().default("America/New_York"),
  plan: text("plan").notNull().default("free"),
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: userRef(),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    userId: userRef(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("accounts_user_idx").on(t.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

// ───────────────────────────── Documents ─────────────────────────────

export const documents = pgTable(
  "documents",
  {
    id: id(),
    userId: userRef(),
    source: text("source").$type<DocumentSource>().notNull(),
    /** Provider-side reference (e.g. email Message-ID) for dedup across sources. Never content. */
    sourceRef: text("source_ref"),
    storageKey: text("storage_key").notNull(),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    status: text("status").$type<DocumentStatus>().notNull().default("queued"),
    stage: text("stage").$type<DocumentStage>().notNull().default("received"),
    failureReason: text("failure_reason"),
    /** Normalized text used for search and re-extraction. */
    textContent: text("text_content"),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('english', coalesce(original_filename, '') || ' ' || coalesce(text_content, ''))`,
    ),
    pageCount: integer("page_count"),
    processingMs: integer("processing_ms"),
    createdAt: createdAt(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("documents_user_sha_uidx").on(t.userId, t.sha256),
    index("documents_user_created_idx").on(t.userId, t.createdAt),
    index("documents_search_idx").using("gin", t.searchVector),
  ],
);

export const documentExtractions = pgTable(
  "document_extractions",
  {
    id: id(),
    userId: userRef(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    documentType: text("document_type").notNull(),
    classificationConfidence: real("classification_confidence").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    schemaVersion: text("schema_version").notNull(),
    /** Raw structured model output (pre-validation), kept for debugging/eval. */
    rawOutput: jsonb("raw_output"),
    /** Output after Zod validation + grounding + sanity checks. */
    output: jsonb("output"),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    overallConfidence: real("overall_confidence").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    latencyMs: integer("latency_ms"),
    createdAt: createdAt(),
  },
  (t) => [index("extractions_user_doc_idx").on(t.userId, t.documentId)],
);

// ───────────────────────────── Items & facts ─────────────────────────────

export const categories = pgTable("categories", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  sortOrder: smallint("sort_order").notNull().default(0),
});

export const items = pgTable(
  "items",
  {
    id: id(),
    userId: userRef(),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }),
    extractionId: uuid("extraction_id").references(() => documentExtractions.id, { onDelete: "set null" }),
    kind: text("kind").$type<ItemKind>().notNull(),
    title: text("title").notNull(),
    merchant: text("merchant"),
    amountCents: bigint("amount_cents", { mode: "number" }),
    currency: text("currency"),
    /** The date that matters most for display (purchase date, renewal, expiry). */
    primaryDate: date("primary_date", { mode: "string" }),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    confidence: real("confidence").notNull(),
    needsReview: boolean("needs_review").notNull().default(false),
    state: text("state").$type<ItemState>().notNull().default("active"),
    userImportance: smallint("user_importance").notNull().default(0),
    /** Set when this item likely describes the same thing as another item. */
    possibleDuplicateOf: uuid("possible_duplicate_of"),
    /** Set when another document disagrees with this item's facts. */
    conflictNote: text("conflict_note"),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('english', coalesce(title, '') || ' ' || coalesce(merchant, '') || ' ' || kind)`,
    ),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("items_user_state_idx").on(t.userId, t.state),
    index("items_user_kind_idx").on(t.userId, t.kind),
    index("items_user_merchant_idx").on(t.userId, t.merchant),
    index("items_search_idx").using("gin", t.searchVector),
  ],
);

export const itemCategories = pgTable(
  "item_categories",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    userId: userRef(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.categoryId] }), index("item_categories_user_idx").on(t.userId)],
);

/**
 * Every fact we show the user, with provenance. This is the canonical record
 * the UI renders and the user edits; typed tables below are projections of it.
 */
export const itemFacts = pgTable(
  "item_facts",
  {
    id: id(),
    userId: userRef(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    valueText: text("value_text"),
    valueDate: date("value_date", { mode: "string" }),
    valueCents: bigint("value_cents", { mode: "number" }),
    valueNumber: real("value_number"),
    currency: text("currency"),
    certainty: text("certainty").$type<Certainty>().notNull(),
    basis: text("basis").$type<Basis>().notNull(),
    /** Verbatim quote from the source document, when there is one. */
    evidence: text("evidence"),
    /** Plain-English explanation shown under the fact ("Based on Best Buy's typical policy…"). */
    explanation: text("explanation"),
    confidence: real("confidence").notNull(),
    userConfirmedAt: timestamp("user_confirmed_at", { withTimezone: true }),
    userEditedAt: timestamp("user_edited_at", { withTimezone: true }),
    sortOrder: smallint("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("item_facts_item_key_uidx").on(t.itemId, t.key),
    index("item_facts_user_key_date_idx").on(t.userId, t.key, t.valueDate),
  ],
);

export const purchases = pgTable(
  "purchases",
  {
    itemId: uuid("item_id")
      .primaryKey()
      .references(() => items.id, { onDelete: "cascade" }),
    userId: userRef(),
    purchaseDate: date("purchase_date", { mode: "string" }),
    orderNumber: text("order_number"),
    subtotalCents: bigint("subtotal_cents", { mode: "number" }),
    taxCents: bigint("tax_cents", { mode: "number" }),
    totalCents: bigint("total_cents", { mode: "number" }),
    paymentLast4: text("payment_last4"),
    returnDeadline: date("return_deadline", { mode: "string" }),
    returnDeadlineCertainty: text("return_deadline_certainty").$type<Certainty>().notNull().default("unknown"),
    lineItems: jsonb("line_items")
      .$type<Array<{ name: string; quantity: number | null; totalCents: number | null }>>()
      .notNull()
      .default([]),
  },
  (t) => [index("purchases_user_return_idx").on(t.userId, t.returnDeadline)],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    itemId: uuid("item_id")
      .primaryKey()
      .references(() => items.id, { onDelete: "cascade" }),
    userId: userRef(),
    serviceName: text("service_name").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }),
    currency: text("currency"),
    billingPeriod: text("billing_period").$type<"weekly" | "monthly" | "annual" | "other" | "unknown">(),
    trialEndsOn: date("trial_ends_on", { mode: "string" }),
    nextRenewalOn: date("next_renewal_on", { mode: "string" }),
    renewalCertainty: text("renewal_certainty").$type<Certainty>().notNull().default("unknown"),
    status: text("status").$type<"trial" | "active" | "cancelled" | "unknown">().notNull().default("unknown"),
  },
  (t) => [index("subscriptions_user_renewal_idx").on(t.userId, t.nextRenewalOn)],
);

export const warranties = pgTable(
  "warranties",
  {
    itemId: uuid("item_id")
      .primaryKey()
      .references(() => items.id, { onDelete: "cascade" }),
    userId: userRef(),
    coveredItemId: uuid("covered_item_id").references(() => items.id, { onDelete: "set null" }),
    provider: text("provider"),
    startsOn: date("starts_on", { mode: "string" }),
    endsOn: date("ends_on", { mode: "string" }),
    durationMonths: integer("duration_months"),
    endsOnCertainty: text("ends_on_certainty").$type<Certainty>().notNull().default("unknown"),
    coverageSummary: text("coverage_summary"),
  },
  (t) => [index("warranties_user_ends_idx").on(t.userId, t.endsOn)],
);

export const travelCredits = pgTable(
  "travel_credits",
  {
    itemId: uuid("item_id")
      .primaryKey()
      .references(() => items.id, { onDelete: "cascade" }),
    userId: userRef(),
    carrier: text("carrier"),
    amountCents: bigint("amount_cents", { mode: "number" }),
    currency: text("currency"),
    expiresOn: date("expires_on", { mode: "string" }),
    expiresOnCertainty: text("expires_on_certainty").$type<Certainty>().notNull().default("unknown"),
    /** Confirmation / credit code — app-level encrypted (AES-256-GCM). */
    creditReferenceEnc: bytea("credit_reference_enc"),
  },
  (t) => [index("travel_credits_user_expires_idx").on(t.userId, t.expiresOn)],
);

// ───────────────────────────── Money protected / saved ─────────────────────────────

/**
 * An active opportunity with monetary value: a return window, a warranty, a
 * travel credit, a refund owed. "Money Protected" is computed from these.
 * It is NOT money saved.
 */
export const protections = pgTable(
  "protections",
  {
    id: id(),
    userId: userRef(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ProtectionKind>().notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    activeUntil: date("active_until", { mode: "string" }),
    certainty: text("certainty").$type<Certainty>().notNull(),
    status: text("status").$type<ProtectionStatus>().notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("protections_item_kind_uidx").on(t.itemId, t.kind),
    index("protections_user_status_idx").on(t.userId, t.status),
  ],
);

/**
 * Verified financial outcomes. "Money Saved" only ever sums rows here, and a
 * row only exists when the user confirms the outcome.
 */
export const financialOutcomes = pgTable(
  "financial_outcomes",
  {
    id: id(),
    userId: userRef(),
    itemId: uuid("item_id").references(() => items.id, { onDelete: "set null" }),
    protectionId: uuid("protection_id").references(() => protections.id, { onDelete: "set null" }),
    kind: text("kind").$type<OutcomeKind>().notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    note: text("note"),
    confirmedByUserAt: timestamp("confirmed_by_user_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("outcomes_user_idx").on(t.userId)],
);

// ───────────────────────────── Actions & reminders ─────────────────────────────

export const actions = pgTable(
  "actions",
  {
    id: id(),
    userId: userRef(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    protectionId: uuid("protection_id").references(() => protections.id, { onDelete: "set null" }),
    type: text("type").$type<ActionType>().notNull(),
    title: text("title").notNull(),
    description: text("description"),
    dueOn: date("due_on", { mode: "string" }),
    dueCertainty: text("due_certainty").$type<Certainty>().notNull(),
    estimatedValueCents: bigint("estimated_value_cents", { mode: "number" }),
    currency: text("currency"),
    consequence: text("consequence").$type<Consequence>().notNull(),
    priorityScore: real("priority_score").notNull().default(0),
    priorityReason: text("priority_reason"),
    suggestedAction: text("suggested_action"),
    confidence: real("confidence").notNull(),
    status: text("status").$type<ActionStatus>().notNull().default("open"),
    snoozedUntil: date("snoozed_until", { mode: "string" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("actions_item_type_uidx").on(t.itemId, t.type),
    index("actions_user_status_priority_idx").on(t.userId, t.status, t.priorityScore),
    index("actions_user_due_idx").on(t.userId, t.dueOn),
  ],
);

export const reminders = pgTable(
  "reminders",
  {
    id: id(),
    userId: userRef(),
    actionId: uuid("action_id")
      .notNull()
      .references(() => actions.id, { onDelete: "cascade" }),
    remindAt: timestamp("remind_at", { withTimezone: true }).notNull(),
    preset: text("preset").$type<ReminderPreset>().notNull(),
    channels: text("channels").array().$type<ReminderChannel[]>().notNull(),
    status: text("status").$type<ReminderStatus>().notNull().default("scheduled"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("reminders_status_remind_at_idx").on(t.status, t.remindAt),
    index("reminders_user_idx").on(t.userId, t.remindAt),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: userRef(),
    reminderId: uuid("reminder_id").references(() => reminders.id, { onDelete: "set null" }),
    actionId: uuid("action_id").references(() => actions.id, { onDelete: "set null" }),
    channel: text("channel").$type<ReminderChannel>().notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_created_idx").on(t.userId, t.createdAt)],
);

export const notificationPreferences = pgTable("notification_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  emailEnabled: boolean("email_enabled").notNull().default(true),
  inAppEnabled: boolean("in_app_enabled").notNull().default(true),
  defaultPreset: text("default_preset").$type<ReminderPreset>().notNull().default("3_days_before"),
  /** Local hour (0–23, user timezone) reminders are delivered at. */
  deliveryHour: smallint("delivery_hour").notNull().default(9),
  updatedAt: updatedAt(),
});

// ───────────────────────────── Audit ─────────────────────────────

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    /** Nulled (not deleted) on account deletion so the event trail survives without identity. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    actor: text("actor").$type<"user" | "system" | "worker">().notNull(),
    event: text("event").notNull(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    /** NEVER document content or extracted personal data. */
    metadata: jsonb("metadata").$type<Record<string, string | number | boolean | null>>().notNull().default({}),
    ipHash: text("ip_hash"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_user_created_idx").on(t.userId, t.createdAt)],
);

// ───────────────────────────── Ingestion sources (Phase 1.5 / 2) ─────────────────────────────
// Designed now so forwarded email, Gmail and Outlook feed the same `ingest()` entry point
// as uploads. Not wired to any endpoint yet.

export const inboundAddresses = pgTable(
  "inbound_addresses",
  {
    id: id(),
    userId: userRef(),
    /** Random token forming the local part of the forwarding address. */
    token: text("token").notNull().unique(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("inbound_addresses_user_idx").on(t.userId)],
);

export const emailConnections = pgTable(
  "email_connections",
  {
    id: id(),
    userId: userRef(),
    provider: text("provider").$type<"gmail" | "outlook">().notNull(),
    emailAddress: text("email_address").notNull(),
    refreshTokenEnc: bytea("refresh_token_enc").notNull(),
    scopes: text("scopes").array().notNull(),
    syncCursor: text("sync_cursor"),
    status: text("status").$type<"active" | "revoked" | "error">().notNull().default("active"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("email_connections_user_idx").on(t.userId)],
);

/** Relevance-filter decisions. Skipped messages keep ONLY ids + score, never content. */
export const inboundMessages = pgTable(
  "inbound_messages",
  {
    id: id(),
    userId: userRef(),
    connectionId: uuid("connection_id").references(() => emailConnections.id, { onDelete: "cascade" }),
    providerMessageId: text("provider_message_id").notNull(),
    relevanceScore: real("relevance_score").notNull(),
    relevanceReason: text("relevance_reason"),
    status: text("status").$type<"skipped" | "ingested">().notNull(),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("inbound_messages_user_msg_uidx").on(t.userId, t.providerMessageId)],
);

/** Tables protected by RLS (kept in sync with the RLS migration; asserted by tests). */
export const RLS_TABLES = [
  "documents",
  "document_extractions",
  "items",
  "item_categories",
  "item_facts",
  "purchases",
  "subscriptions",
  "warranties",
  "travel_credits",
  "protections",
  "financial_outcomes",
  "actions",
  "reminders",
  "notifications",
  "notification_preferences",
  "audit_events",
  "inbound_addresses",
  "email_connections",
  "inbound_messages",
] as const;
