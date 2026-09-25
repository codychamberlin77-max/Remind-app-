/** Shared domain vocabulary. Imported by schema, pipeline, and UI. */

export const CERTAINTIES = ["confirmed", "estimated", "unknown"] as const;
/**
 * confirmed – stated on the document (grounded evidence) or entered/confirmed by the user
 * estimated – derived from an external rule (merchant policy, manufacturer default) or an
 *             inference we could not ground; always shown with its basis
 * unknown   – we do not know; we never display a value as if we did
 */
export type Certainty = (typeof CERTAINTIES)[number];

export const BASES = [
  "stated_on_document",
  "computed_from_document", // e.g. purchase date + a return period printed on the receipt
  "merchant_policy",
  "manufacturer_default",
  "inferred", // model inference without verbatim evidence — never "confirmed"
  "unclear_on_document", // on the document but hard to read / ambiguous
  "user_entered",
  "none",
] as const;
export type Basis = (typeof BASES)[number];

export const DOCUMENT_SOURCES = ["upload", "sample", "email_forward", "gmail", "outlook"] as const;
export type DocumentSource = (typeof DOCUMENT_SOURCES)[number];

export type DocumentStatus = "queued" | "processing" | "processed" | "needs_review" | "failed" | "unsupported";

/** Pipeline stages, surfaced to the user as real progress. */
export type DocumentStage =
  | "received"
  | "reading"
  | "classifying"
  | "extracting"
  | "verifying"
  | "checking_policies"
  | "finding_actions"
  | "done"
  | "failed";

export const ITEM_KINDS = [
  "purchase",
  "subscription",
  "warranty",
  "travel_credit",
  "bill",
  "appointment",
  "insurance",
  "vehicle",
  "document",
  "other",
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export type ItemState = "active" | "saved" | "archived" | "dismissed";

export const ACTION_TYPES = [
  "return",
  "cancel_trial",
  "review_renewal",
  "use_credit",
  "pay_bill",
  "warranty_expiring",
  "attend",
  "review_extraction",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export type ActionStatus = "open" | "snoozed" | "done" | "dismissed";

export type Consequence = "lose_money" | "charged" | "lose_coverage" | "late_fee" | "inconvenience";

export type ProtectionKind = "return_window" | "warranty" | "travel_credit" | "refund";
export type ProtectionStatus = "active" | "expired" | "used" | "dismissed";

export type OutcomeKind =
  | "return_completed"
  | "refund_received"
  | "credit_used"
  | "warranty_claim_paid"
  | "cancelled_before_charge"
  | "other";

export const REMINDER_PRESETS = ["today", "tomorrow", "3_days_before", "1_week_before", "custom"] as const;
export type ReminderPreset = (typeof REMINDER_PRESETS)[number];
export type ReminderChannel = "in_app" | "email" | "push" | "sms";
export type ReminderStatus = "scheduled" | "sent" | "failed" | "cancelled";

export const CATEGORY_SEED = [
  { slug: "purchases", name: "Purchases", sortOrder: 1 },
  { slug: "returns", name: "Returns", sortOrder: 2 },
  { slug: "warranties", name: "Warranties", sortOrder: 3 },
  { slug: "subscriptions", name: "Subscriptions", sortOrder: 4 },
  { slug: "travel", name: "Travel", sortOrder: 5 },
  { slug: "bills", name: "Bills", sortOrder: 6 },
  { slug: "documents", name: "Documents", sortOrder: 7 },
  { slug: "renewals", name: "Renewals", sortOrder: 8 },
  { slug: "appointments", name: "Appointments", sortOrder: 9 },
  { slug: "other", name: "Other", sortOrder: 10 },
] as const;
export type CategorySlug = (typeof CATEGORY_SEED)[number]["slug"];
