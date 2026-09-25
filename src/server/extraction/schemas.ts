import { z } from "zod";

/**
 * Model-facing extraction schemas. Every important value is wrapped with the
 * verbatim `evidence` it came from and a self-reported confidence. The model is
 * told that null is always an acceptable answer.
 *
 * Bump SCHEMA_VERSION whenever these shapes change; it is stored on every
 * extraction so old documents can be re-processed.
 */
export const SCHEMA_VERSION = "2026-09-25.1";

const confidence = z.number().min(0).max(1).describe("0–1. How sure you are this value is correct AND on the document.");
const evidence = z
  .string()
  .nullable()
  .describe("Exact, verbatim quote from the document containing the value (max ~160 chars). null if not present.");

export const textField = z.object({
  value: z.string().nullable(),
  evidence,
  confidence,
});
export const numberField = z.object({ value: z.number().nullable(), evidence, confidence });
export const moneyField = z.object({
  value: z.number().nullable().describe("Decimal amount, e.g. 1299.00. null if not stated."),
  currency: z.string().length(3).nullable().describe("ISO 4217 code, e.g. USD. null if unclear."),
  evidence,
  confidence,
});
export const dateField = z.object({
  value: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .describe("YYYY-MM-DD. ONLY if the document states this date. Never compute or guess. null otherwise."),
  evidence,
  confidence,
});

export type TextField = z.infer<typeof textField>;
export type NumberField = z.infer<typeof numberField>;
export type MoneyField = z.infer<typeof moneyField>;
export type DateField = z.infer<typeof dateField>;

export const DOCUMENT_TYPES = [
  "purchase_receipt",
  "order_confirmation",
  "subscription",
  "warranty",
  "travel_credit",
  "travel_confirmation",
  "shipping_confirmation",
  "return_confirmation",
  "refund",
  "bill",
  "appointment",
  "insurance",
  "vehicle",
  "contract",
  "other",
  "unreadable",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const classificationSchema = z.object({
  document_type: z.enum(DOCUMENT_TYPES),
  confidence,
  is_actionable: z.boolean().describe("Does this document imply a deadline, renewal, expiry, return window, bill, or appointment?"),
  reason: z.string().max(200).describe("One short sentence. Do not repeat personal details."),
});
export type Classification = z.infer<typeof classificationSchema>;

export const transcriptionSchema = z.object({
  text: z.string().describe("Faithful transcription of all legible text, preserving line breaks. Use [illegible] for unreadable parts."),
  legibility: z.enum(["good", "partial", "poor"]),
});
export type Transcription = z.infer<typeof transcriptionSchema>;

const lineItem = z.object({
  name: z.string(),
  quantity: z.number().nullable(),
  total_price: z.number().nullable(),
  evidence,
  confidence,
});

export const purchaseSchema = z.object({
  orders: z
    .array(
      z.object({
        merchant: textField,
        purchase_date: dateField,
        order_number: textField,
        line_items: z.array(lineItem),
        subtotal: moneyField,
        tax: moneyField,
        total: moneyField,
        payment_last4: textField.describe("Last 4 digits of the card only, if shown."),
        return_policy: z.object({
          return_days: numberField.describe("Number of days allowed for returns, ONLY if the document states it."),
          return_by_date: dateField.describe("An explicit 'return by' date, ONLY if printed."),
          policy_text: textField,
        }),
        warranty: z.object({
          duration_months: numberField.describe("Warranty / protection plan length in months, ONLY if stated."),
          provider: textField,
          ends_on: dateField,
          covered_item: textField,
        }),
      }),
    )
    .describe("Usually one order. Multiple only if the document clearly contains separate orders/receipts."),
});
export type PurchaseExtraction = z.infer<typeof purchaseSchema>;

export const subscriptionSchema = z.object({
  service_name: textField,
  plan_name: textField,
  amount: moneyField,
  billing_period: z.object({
    value: z.enum(["weekly", "monthly", "annual", "other"]).nullable(),
    evidence,
    confidence,
  }),
  status: z.object({ value: z.enum(["trial", "active", "cancelled"]).nullable(), evidence, confidence }),
  trial_end_date: dateField,
  next_renewal_date: dateField,
  email_sent_date: dateField.describe("Date the message was sent, if shown (e.g. a Date: header)."),
});
export type SubscriptionExtraction = z.infer<typeof subscriptionSchema>;

export const warrantySchema = z.object({
  product_name: textField,
  provider: textField,
  purchase_price: moneyField,
  purchase_date: dateField,
  start_date: dateField,
  end_date: dateField,
  duration_months: numberField,
  coverage_summary: textField,
});
export type WarrantyExtraction = z.infer<typeof warrantySchema>;

export const travelCreditSchema = z.object({
  carrier: textField,
  amount: moneyField,
  expiration_date: dateField,
  expiration_rule: z.object({
    value: z.enum(["book_by", "travel_by", "unknown"]).nullable(),
    evidence,
    confidence,
  }),
  credit_code: textField.describe("Credit / ticket / confirmation number, if shown."),
  issued_date: dateField,
});
export type TravelCreditExtraction = z.infer<typeof travelCreditSchema>;

export const genericSchema = z.object({
  title: textField.describe("Short neutral title, e.g. 'Electric bill' or 'Dentist appointment'."),
  organization: textField,
  amount: moneyField,
  key_dates: z.array(
    z.object({
      label: z.enum(["due_date", "appointment", "expiration", "renewal", "other"]),
      date: dateField,
    }),
  ),
});
export type GenericExtraction = z.infer<typeof genericSchema>;

export type ExtractionFamily = "purchase" | "subscription" | "warranty" | "travel_credit" | "generic";

export function familyFor(type: DocumentType): ExtractionFamily | null {
  switch (type) {
    case "purchase_receipt":
    case "order_confirmation":
      return "purchase";
    case "subscription":
      return "subscription";
    case "warranty":
      return "warranty";
    case "travel_credit":
      return "travel_credit";
    case "bill":
    case "appointment":
    case "insurance":
    case "vehicle":
    case "contract":
    case "travel_confirmation":
    case "refund":
      return "generic";
    default:
      return null; // other / unreadable / shipping / return confirmations: filed, no extraction
  }
}

export const SCHEMAS = {
  purchase: purchaseSchema,
  subscription: subscriptionSchema,
  warranty: warrantySchema,
  travel_credit: travelCreditSchema,
  generic: genericSchema,
} as const;

export type ExtractionByFamily = {
  purchase: PurchaseExtraction;
  subscription: SubscriptionExtraction;
  warranty: WarrantyExtraction;
  travel_credit: TravelCreditExtraction;
  generic: GenericExtraction;
};
