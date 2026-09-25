import type { Basis, Certainty } from "@/server/domain/types";
import { checkDateAgainstEvidence, daysBetween, formatDate, type DateOrder } from "./dates";
import {
  DocumentIndex,
  evidenceContainsAmount,
  evidenceSupportsCount,
  normalizeForMatch,
} from "./grounding";
import type {
  DateField,
  GenericExtraction,
  MoneyField,
  NumberField,
  PurchaseExtraction,
  SubscriptionExtraction,
  TextField,
  TravelCreditExtraction,
  WarrantyExtraction,
} from "./schemas";

/**
 * A value after deterministic verification. This — not the model's output —
 * is what the rest of the system is allowed to use.
 */
export type Verified<T> = {
  value: T | null;
  certainty: Certainty;
  basis: Basis;
  evidence: string | null;
  confidence: number;
  explanation: string | null;
};

export const CONFIRM_THRESHOLD = 0.75;

export type VerifyContext = {
  index: DocumentIndex;
  /** Today in the user's timezone (YYYY-MM-DD). */
  today: string;
  /** Anchor date from the document itself (sent date / purchase date), if grounded. */
  referenceIso: string | null;
  order: DateOrder | null;
  /** Multiplicative cap for vision-transcribed documents. 1 for native text. */
  readCap: number;
  warnings: string[];
};

export function unknown<T>(explanation: string | null = null): Verified<T> {
  return { value: null, certainty: "unknown", basis: "none", evidence: null, confidence: 0, explanation };
}

function finalize<T>(value: T, evidence: string | null, confidence: number, explanation: string | null = null): Verified<T> {
  if (confidence >= CONFIRM_THRESHOLD) {
    return { value, certainty: "confirmed", basis: "stated_on_document", evidence, confidence, explanation };
  }
  return {
    value,
    certainty: "estimated",
    basis: "unclear_on_document",
    evidence,
    confidence,
    explanation: explanation ?? "This was hard to read on the document. Please check it.",
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

export function verifyText(f: TextField | undefined, ctx: VerifyContext, label: string): Verified<string> {
  if (!f || f.value == null || !f.value.trim()) return unknown();
  const value = f.value.trim();
  const g = ctx.index.ground(f.evidence, { allowFuzzy: true });
  if (g === "none") {
    // A value we can't find on the page is never "confirmed".
    ctx.warnings.push(`ungrounded_text:${label}`);
    return {
      value,
      certainty: "estimated",
      basis: "inferred",
      evidence: null,
      confidence: round(Math.min(f.confidence, 0.5)),
      explanation: "We couldn't find this exact text on the document.",
    };
  }
  const valueInEvidence = tokensOverlap(value, f.evidence ?? "") >= 0.5;
  let conf = Math.min(f.confidence, g === "exact" ? 1 : 0.85, ctx.readCap);
  if (!valueInEvidence) conf = Math.min(conf, 0.6);
  return finalize(value, f.evidence, round(conf));
}

function tokensOverlap(a: string, b: string): number {
  const ta = normalizeForMatch(a).split(/[^a-z0-9]+/).filter(Boolean);
  const tb = new Set(normalizeForMatch(b).split(/[^a-z0-9]+/).filter(Boolean));
  if (!ta.length) return 0;
  return ta.filter((t) => tb.has(t)).length / ta.length;
}

/** Money must be quoted verbatim; otherwise it is dropped (never shown as fact). */
export function verifyMoney(
  f: MoneyField | undefined,
  ctx: VerifyContext,
  label: string,
): Verified<{ cents: number; currency: string }> {
  if (!f || f.value == null) return unknown();
  if (!Number.isFinite(f.value) || f.value < 0 || f.value > 10_000_000) {
    ctx.warnings.push(`implausible_amount:${label}`);
    return unknown();
  }
  if (!ctx.index.containsStrict(f.evidence) || !evidenceContainsAmount(f.evidence!, f.value)) {
    ctx.warnings.push(`ungrounded_amount:${label}`);
    return unknown();
  }
  const currency = f.currency ?? guessCurrency(f.evidence!) ?? "USD";
  return finalize(
    { cents: Math.round(f.value * 100), currency },
    f.evidence,
    round(Math.min(f.confidence, ctx.readCap)),
  );
}

function guessCurrency(ev: string): string | null {
  if (/\$|usd/i.test(ev)) return "USD";
  if (/€|eur/i.test(ev)) return "EUR";
  if (/£|gbp/i.test(ev)) return "GBP";
  return null;
}

export function verifyCount(
  f: NumberField | undefined,
  ctx: VerifyContext,
  label: string,
  unit: "days" | "months",
  range: [number, number],
): Verified<number> {
  if (!f || f.value == null) return unknown();
  const v = f.value;
  if (!Number.isInteger(v) || v < range[0] || v > range[1]) {
    ctx.warnings.push(`implausible_count:${label}`);
    return unknown();
  }
  if (!ctx.index.containsStrict(f.evidence) || !evidenceSupportsCount(f.evidence!, v, unit)) {
    ctx.warnings.push(`ungrounded_count:${label}`);
    return unknown();
  }
  return finalize(v, f.evidence, round(Math.min(f.confidence, ctx.readCap)));
}

/**
 * The anti-hallucination core for dates. A date survives only if:
 *   1. its evidence quote is on the document (strict match), and
 *   2. our own parser reads that quote as the same calendar date.
 * Ambiguous numeric dates are downgraded to "estimated" with the alternative shown.
 */
export function verifyDate(
  f: DateField | undefined,
  ctx: VerifyContext,
  label: string,
  opts: { kind: "past" | "future" | "any" } = { kind: "any" },
): Verified<string> {
  if (!f || f.value == null) return unknown();
  if (!ctx.index.containsStrict(f.evidence)) {
    ctx.warnings.push(`ungrounded_date:${label}`);
    return unknown();
  }
  const check = checkDateAgainstEvidence(f.value, f.evidence!, {
    referenceIso: ctx.referenceIso ?? ctx.today,
    order: ctx.order,
  });
  if (check.status === "unsupported") {
    ctx.warnings.push(`date_mismatch:${label}`);
    return unknown();
  }

  const iso = f.value;
  const yearsOff = Math.abs(daysBetween(ctx.today, iso)) / 365;
  if (yearsOff > 15) {
    ctx.warnings.push(`implausible_date:${label}`);
    return unknown();
  }
  if (opts.kind === "past" && daysBetween(ctx.today, iso) > 1) {
    ctx.warnings.push(`future_past_date:${label}`);
    return unknown();
  }

  let conf = Math.min(f.confidence, ctx.readCap);
  let explanation: string | null = null;

  if (check.status === "ambiguous") {
    ctx.warnings.push(`ambiguous_date:${label}`);
    return {
      value: iso,
      certainty: "estimated",
      basis: "unclear_on_document",
      evidence: f.evidence,
      confidence: round(Math.min(conf, 0.5)),
      explanation: `“${f.evidence!.trim()}” could mean ${formatDate(iso)} or ${formatDate(check.alternative)}. Please confirm.`,
    };
  }

  const c = check.candidate;
  if (c.form === "weekday" || c.form === "relative") {
    if (!ctx.referenceIso) {
      // "Renews Friday" with no sent date on the document: we can't know which Friday.
      ctx.warnings.push(`relative_without_anchor:${label}`);
      return {
        value: iso,
        certainty: "estimated",
        basis: "inferred",
        evidence: f.evidence,
        confidence: round(Math.min(conf, 0.5)),
        explanation: `The document says “${f.evidence!.trim()}” without a full date; we assumed the next one.`,
      };
    }
    explanation = `The document says “${f.evidence!.trim()}”, relative to ${formatDate(ctx.referenceIso)}.`;
    conf = Math.min(conf, 0.9);
  } else if (c.yearInferred) {
    conf = Math.min(conf, ctx.referenceIso ? 0.85 : 0.6);
    explanation = "The year isn't printed; we used the document's date to fill it in.";
  }
  return finalize(iso, f.evidence, round(conf), explanation);
}

// ───────────────────────── Per-family verification ─────────────────────────

export type VerifiedOrder = {
  merchant: Verified<string>;
  purchaseDate: Verified<string>;
  orderNumber: Verified<string>;
  lineItems: Array<{ name: string; quantity: number | null; totalCents: number | null; grounded: boolean }>;
  subtotal: Verified<{ cents: number; currency: string }>;
  tax: Verified<{ cents: number; currency: string }>;
  total: Verified<{ cents: number; currency: string }>;
  paymentLast4: Verified<string>;
  returnDays: Verified<number>;
  returnByDate: Verified<string>;
  returnPolicyText: Verified<string>;
  warrantyMonths: Verified<number>;
  warrantyProvider: Verified<string>;
  warrantyEndsOn: Verified<string>;
  warrantyCoveredItem: Verified<string>;
};

export function verifyPurchase(x: PurchaseExtraction, ctx: VerifyContext): VerifiedOrder[] {
  return x.orders.map((o, i) => {
    const p = `order${i}`;
    const purchaseDate = verifyDate(o.purchase_date, ctx, `${p}.purchase_date`, { kind: "past" });
    // Later relative/partial dates anchor on the (grounded) purchase date.
    const local: VerifyContext = { ...ctx, referenceIso: ctx.referenceIso ?? (purchaseDate.certainty === "confirmed" ? purchaseDate.value : null) };

    const lineItems = o.line_items.map((li) => {
      const grounded = local.index.ground(li.evidence, { allowFuzzy: true }) !== "none";
      const priceOk =
        li.total_price != null && grounded && li.evidence != null && evidenceContainsAmount(li.evidence, li.total_price);
      return {
        name: li.name.trim(),
        quantity: li.quantity,
        totalCents: priceOk ? Math.round(li.total_price! * 100) : null,
        grounded,
      };
    }).filter((li) => li.grounded && li.name);
    if (lineItems.length < o.line_items.length) local.warnings.push(`ungrounded_line_items:${p}`);

    const v: VerifiedOrder = {
      merchant: verifyText(o.merchant, local, `${p}.merchant`),
      purchaseDate,
      orderNumber: verifyText(o.order_number, local, `${p}.order_number`),
      lineItems,
      subtotal: verifyMoney(o.subtotal, local, `${p}.subtotal`),
      tax: verifyMoney(o.tax, local, `${p}.tax`),
      total: verifyMoney(o.total, local, `${p}.total`),
      paymentLast4: verifyLast4(o.payment_last4, local),
      returnDays: verifyCount(o.return_policy.return_days, local, `${p}.return_days`, "days", [1, 365]),
      returnByDate: verifyDate(o.return_policy.return_by_date, local, `${p}.return_by`, { kind: "future" }),
      returnPolicyText: verifyText(o.return_policy.policy_text, local, `${p}.policy_text`),
      warrantyMonths: verifyCount(o.warranty.duration_months, local, `${p}.warranty_months`, "months", [1, 240]),
      warrantyProvider: verifyText(o.warranty.provider, local, `${p}.warranty_provider`),
      warrantyEndsOn: verifyDate(o.warranty.ends_on, local, `${p}.warranty_ends`, { kind: "future" }),
      warrantyCoveredItem: verifyText(o.warranty.covered_item, local, `${p}.warranty_item`),
    };
    checkArithmetic(v, local, p);
    if (
      v.returnByDate.value &&
      v.purchaseDate.value &&
      daysBetween(v.purchaseDate.value, v.returnByDate.value) < 0
    ) {
      local.warnings.push(`deadline_before_purchase:${p}`);
      v.returnByDate = unknown();
    }
    return v;
  });
}

function verifyLast4(f: TextField | undefined, ctx: VerifyContext): Verified<string> {
  const v = verifyText(f, ctx, "payment_last4");
  if (v.value && !/^\d{4}$/.test(v.value)) return unknown();
  return v;
}

/** Totals that don't add up lower confidence in every amount on the receipt. */
function checkArithmetic(v: VerifiedOrder, ctx: VerifyContext, p: string) {
  const total = v.total.value?.cents;
  if (total == null) return;
  const sub = v.subtotal.value?.cents;
  const tax = v.tax.value?.cents ?? 0;
  const itemsSum = v.lineItems.reduce((s, li) => s + (li.totalCents ?? 0), 0);
  const tolerance = 2;
  let ok = true;
  if (sub != null && Math.abs(sub + tax - total) > tolerance) ok = false;
  if (sub != null && itemsSum > 0 && v.lineItems.every((li) => li.totalCents != null) && Math.abs(itemsSum - sub) > tolerance) ok = false;
  if (!ok) {
    ctx.warnings.push(`arithmetic_mismatch:${p}`);
    for (const k of ["total", "subtotal", "tax"] as const) {
      const f = v[k];
      if (f.value) v[k] = { ...f, confidence: round(f.confidence * 0.7), ...(f.confidence * 0.7 < CONFIRM_THRESHOLD ? { certainty: "estimated" as const, basis: "unclear_on_document" as const, explanation: "The totals on this receipt don't add up. Please check the amount." } : {}) };
    }
  }
}

export type VerifiedSubscription = {
  serviceName: Verified<string>;
  planName: Verified<string>;
  amount: Verified<{ cents: number; currency: string }>;
  billingPeriod: Verified<"weekly" | "monthly" | "annual" | "other">;
  status: Verified<"trial" | "active" | "cancelled">;
  trialEndDate: Verified<string>;
  nextRenewalDate: Verified<string>;
  sentDate: Verified<string>;
};

export function verifySubscription(x: SubscriptionExtraction, ctx: VerifyContext): VerifiedSubscription {
  const sentDate = verifyDate(x.email_sent_date, ctx, "sent_date", { kind: "past" });
  const local: VerifyContext = { ...ctx, referenceIso: ctx.referenceIso ?? (sentDate.certainty === "confirmed" ? sentDate.value : null) };
  return {
    serviceName: verifyText(x.service_name, local, "service_name"),
    planName: verifyText(x.plan_name, local, "plan_name"),
    amount: verifyMoney(x.amount, local, "amount"),
    billingPeriod: verifyEnum(x.billing_period, local, "billing_period"),
    status: verifyEnum(x.status, local, "status"),
    trialEndDate: verifyDate(x.trial_end_date, local, "trial_end", { kind: "future" }),
    nextRenewalDate: verifyDate(x.next_renewal_date, local, "next_renewal", { kind: "future" }),
    sentDate,
  };
}

function verifyEnum<T extends string>(
  f: { value: T | null; evidence: string | null; confidence: number },
  ctx: VerifyContext,
  label: string,
): Verified<T> {
  if (f.value == null) return unknown();
  const g = ctx.index.ground(f.evidence, { allowFuzzy: true });
  if (g === "none") {
    ctx.warnings.push(`ungrounded_enum:${label}`);
    return { value: f.value, certainty: "estimated", basis: "inferred", evidence: null, confidence: round(Math.min(f.confidence, 0.5)), explanation: null };
  }
  return finalize(f.value, f.evidence, round(Math.min(f.confidence, ctx.readCap)));
}

export type VerifiedWarranty = {
  productName: Verified<string>;
  provider: Verified<string>;
  purchasePrice: Verified<{ cents: number; currency: string }>;
  purchaseDate: Verified<string>;
  startDate: Verified<string>;
  endDate: Verified<string>;
  durationMonths: Verified<number>;
  coverageSummary: Verified<string>;
};

export function verifyWarranty(x: WarrantyExtraction, ctx: VerifyContext): VerifiedWarranty {
  const purchaseDate = verifyDate(x.purchase_date, ctx, "purchase_date", { kind: "past" });
  const local: VerifyContext = { ...ctx, referenceIso: ctx.referenceIso ?? (purchaseDate.certainty === "confirmed" ? purchaseDate.value : null) };
  return {
    productName: verifyText(x.product_name, local, "product_name"),
    provider: verifyText(x.provider, local, "provider"),
    purchasePrice: verifyMoney(x.purchase_price, local, "purchase_price"),
    purchaseDate,
    startDate: verifyDate(x.start_date, local, "start_date"),
    endDate: verifyDate(x.end_date, local, "end_date"),
    durationMonths: verifyCount(x.duration_months, local, "duration_months", "months", [1, 240]),
    coverageSummary: verifyText(x.coverage_summary, local, "coverage"),
  };
}

export type VerifiedTravelCredit = {
  carrier: Verified<string>;
  amount: Verified<{ cents: number; currency: string }>;
  expirationDate: Verified<string>;
  expirationRule: Verified<"book_by" | "travel_by" | "unknown">;
  creditCode: Verified<string>;
  issuedDate: Verified<string>;
};

export function verifyTravelCredit(x: TravelCreditExtraction, ctx: VerifyContext): VerifiedTravelCredit {
  const issuedDate = verifyDate(x.issued_date, ctx, "issued_date", { kind: "past" });
  const local: VerifyContext = { ...ctx, referenceIso: ctx.referenceIso ?? (issuedDate.certainty === "confirmed" ? issuedDate.value : null) };
  return {
    carrier: verifyText(x.carrier, local, "carrier"),
    amount: verifyMoney(x.amount, local, "amount"),
    expirationDate: verifyDate(x.expiration_date, local, "expiration", { kind: "any" }),
    expirationRule: verifyEnum(x.expiration_rule, local, "expiration_rule"),
    creditCode: verifyText(x.credit_code, local, "credit_code"),
    issuedDate,
  };
}

export type VerifiedGeneric = {
  title: Verified<string>;
  organization: Verified<string>;
  amount: Verified<{ cents: number; currency: string }>;
  keyDates: Array<{ label: GenericExtraction["key_dates"][number]["label"]; date: Verified<string> }>;
};

export function verifyGeneric(x: GenericExtraction, ctx: VerifyContext): VerifiedGeneric {
  return {
    title: verifyText(x.title, ctx, "title"),
    organization: verifyText(x.organization, ctx, "organization"),
    amount: verifyMoney(x.amount, ctx, "amount"),
    keyDates: x.key_dates
      .map((k, i) => ({ label: k.label, date: verifyDate(k.date, ctx, `key_date${i}`) }))
      .filter((k) => k.date.certainty !== "unknown"),
  };
}
