import type { CategorySlug, Certainty, ItemKind } from "@/server/domain/types";
import { addDays, addMonths, formatDate } from "@/server/extraction/dates";
import type { DocumentType } from "@/server/extraction/schemas";
import type {
  Verified,
  VerifiedGeneric,
  VerifiedOrder,
  VerifiedSubscription,
  VerifiedTravelCredit,
  VerifiedWarranty,
} from "@/server/extraction/verify";
import { findManufacturerWarranty, findMerchantPolicy, looksLikeElectronics } from "./merchantPolicies";
import { planFromFacts, type FactLike, type PlannedAction, type PlannedProtection } from "./plan";

/**
 * Deterministic rules engine: verified facts in → item facts out. Deadlines are
 * computed HERE (and in edits), never by the model. Actions and protections
 * are then planned from the facts by `planFromFacts`.
 */

export type DerivedFact = FactLike & { evidence: string | null };
export type DerivedProtection = PlannedProtection;
export type DerivedAction = PlannedAction;

export type TypedPurchase = {
  purchaseDate: string | null;
  orderNumber: string | null;
  subtotalCents: number | null;
  taxCents: number | null;
  totalCents: number | null;
  paymentLast4: string | null;
  returnDeadline: string | null;
  returnDeadlineCertainty: Certainty;
  lineItems: Array<{ name: string; quantity: number | null; totalCents: number | null }>;
};
export type TypedSubscription = {
  serviceName: string;
  amountCents: number | null;
  currency: string | null;
  billingPeriod: "weekly" | "monthly" | "annual" | "other" | "unknown";
  trialEndsOn: string | null;
  nextRenewalOn: string | null;
  renewalCertainty: Certainty;
  status: "trial" | "active" | "cancelled" | "unknown";
};
export type TypedWarranty = {
  provider: string | null;
  startsOn: string | null;
  endsOn: string | null;
  durationMonths: number | null;
  endsOnCertainty: Certainty;
  coverageSummary: string | null;
};
export type TypedTravelCredit = {
  carrier: string | null;
  amountCents: number | null;
  currency: string | null;
  expiresOn: string | null;
  expiresOnCertainty: Certainty;
  creditReference: string | null; // plaintext in memory only; encrypted at persist time
};

export type DerivedItem = {
  kind: ItemKind;
  title: string;
  merchant: string | null;
  amountCents: number | null;
  currency: string | null;
  primaryDate: string | null;
  confidence: number;
  needsReview: boolean;
  details: Record<string, unknown>;
  categories: CategorySlug[];
  facts: DerivedFact[];
  protections: DerivedProtection[];
  actions: DerivedAction[];
  typed: {
    purchase?: TypedPurchase;
    subscription?: TypedSubscription;
    warranty?: TypedWarranty;
    travelCredit?: TypedTravelCredit;
  };
};

export type DeriveContext = { today: string; classificationConfidence: number; documentType: DocumentType; warnings: string[] };

const RANK: Record<Certainty, number> = { confirmed: 2, estimated: 1, unknown: 0 };
export function weakest(...cs: Certainty[]): Certainty {
  return cs.reduce((a, b) => (RANK[b] < RANK[a] ? b : a), "confirmed" as Certainty);
}

function fact<T>(key: string, label: string, v: Verified<T>, map: (x: T) => Partial<DerivedFact>): DerivedFact {
  return {
    key,
    label,
    ...(v.value != null ? map(v.value) : {}),
    certainty: v.certainty,
    basis: v.basis,
    evidence: v.evidence,
    explanation: v.explanation,
    confidence: v.confidence,
  };
}

const moneyMap = (m: { cents: number; currency: string }) => ({ valueCents: m.cents, currency: m.currency });

function mean(ns: number[]): number {
  const xs = ns.filter((n) => Number.isFinite(n) && n > 0);
  return xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : 0;
}

const KEEP_UPPER = new Set(["TV", "QLED", "OLED", "LED", "HD", "UHD", "4K", "8K", "HDMI", "USB", "LG", "HP", "SSD", "GB", "TB", "PC", "XL", "II", "III"]);

/** "SAMSUNG 65\" CLASS Q80D QLED 4K TV" → "Samsung 65\" Class Q80D QLED 4K TV" */
export function prettifyName(name: string): string {
  const letters = name.replace(/[^A-Za-z]/g, "");
  if (!letters || letters !== letters.toUpperCase()) return name;
  return name
    .split(/(\s+)/)
    .map((w) => {
      if (/^\s+$/.test(w) || KEEP_UPPER.has(w) || /\d/.test(w)) return w;
      return w.charAt(0) + w.slice(1).toLowerCase();
    })
    .join("");
}

function cleanProductName(name: string): string {
  return prettifyName(name)
    .replace(/\b(sku|model|upc)[:#]?\s*[\w-]+/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, "")
    .trim();
}

function needsReviewFrom(facts: DerivedFact[], ctx: DeriveContext): boolean {
  if (ctx.classificationConfidence < 0.6) return true;
  return facts.some((f) => f.certainty === "estimated" && (f.basis === "unclear_on_document" || f.basis === "inferred"));
}

export function durationText(months: number): string {
  if (months % 12 === 0) {
    const y = months / 12;
    return `${y} year${y === 1 ? "" : "s"}`;
  }
  return `${months} month${months === 1 ? "" : "s"}`;
}

function finish(item: Omit<DerivedItem, "protections" | "actions">, today: string): DerivedItem {
  const { protections, actions } = planFromFacts(item, today);
  return { ...item, protections, actions };
}

// ───────────────────────────── Purchases ─────────────────────────────

export function derivePurchase(order: VerifiedOrder, ctx: DeriveContext): DerivedItem {
  const merchant = order.merchant.value ? prettifyName(order.merchant.value) : null;
  const names = order.lineItems.map((l) => l.name);
  const priciest = [...order.lineItems].sort((a, b) => (b.totalCents ?? 0) - (a.totalCents ?? 0))[0];
  const title = (priciest && cleanProductName(priciest.name)) || `Purchase at ${merchant ?? "a store"}`;
  const total = order.total.value;

  const facts: DerivedFact[] = [
    fact("total", "Amount", order.total, moneyMap),
    fact("merchant", "Merchant", order.merchant, () => ({ valueText: merchant })),
    fact("purchase_date", "Purchased", order.purchaseDate, (v) => ({ valueDate: v })),
  ];
  if (order.orderNumber.value) facts.push(fact("order_number", "Order number", order.orderNumber, (v) => ({ valueText: v })));

  const ret = returnWindowFact(order, merchant, names);
  facts.push(ret);
  const war = receiptWarrantyFact(order, names);
  if (war) facts.push(war.fact);

  const categories: CategorySlug[] = ["purchases"];
  if (ret.certainty !== "unknown") categories.push("returns");
  if (war && war.fact.certainty !== "unknown") categories.push("warranties");

  return finish(
    {
      kind: "purchase",
      title,
      merchant,
      amountCents: total?.cents ?? null,
      currency: total?.currency ?? null,
      primaryDate: order.purchaseDate.value,
      confidence: mean([order.total.confidence, order.merchant.confidence, order.purchaseDate.confidence]),
      needsReview: needsReviewFrom(facts, ctx),
      details: {
        otherItemCount: Math.max(order.lineItems.length - 1, 0),
        warrantyCoveredCents: war?.coveredCents ?? null,
      },
      categories,
      facts,
      typed: {
        purchase: {
          purchaseDate: order.purchaseDate.value,
          orderNumber: order.orderNumber.value,
          subtotalCents: order.subtotal.value?.cents ?? null,
          taxCents: order.tax.value?.cents ?? null,
          totalCents: total?.cents ?? null,
          paymentLast4: order.paymentLast4.value,
          returnDeadline: ret.valueDate ?? null,
          returnDeadlineCertainty: ret.certainty,
          lineItems: order.lineItems.map((l) => ({ name: l.name, quantity: l.quantity, totalCents: l.totalCents })),
        },
        ...(war && war.fact.certainty !== "unknown"
          ? {
              warranty: {
                provider: war.provider,
                startsOn: order.purchaseDate.value,
                endsOn: war.fact.valueDate ?? null,
                durationMonths: war.fact.valueNumber ?? null,
                endsOnCertainty: war.fact.certainty,
                coverageSummary: null,
              },
            }
          : {}),
      },
    },
    ctx.today,
  );
}

/** Stated date > stated days + purchase date > merchant policy (estimated) > unknown. */
function returnWindowFact(order: VerifiedOrder, merchant: string | null, names: string[]): DerivedFact {
  const base = { key: "return_deadline", label: "Return window" };
  const pd = order.purchaseDate;

  if (order.returnByDate.value) {
    const v = order.returnByDate;
    return { ...base, valueDate: v.value, certainty: v.certainty, basis: v.basis, evidence: v.evidence, confidence: v.confidence, explanation: v.explanation ?? "The return deadline is printed on your receipt." };
  }
  if (order.returnDays.value && pd.value) {
    return {
      ...base,
      valueDate: addDays(pd.value, order.returnDays.value),
      valueNumber: order.returnDays.value,
      certainty: weakest(order.returnDays.certainty, pd.certainty),
      basis: "computed_from_document",
      evidence: order.returnDays.evidence,
      confidence: Math.min(order.returnDays.confidence, pd.confidence),
      explanation: `Your receipt allows ${order.returnDays.value} days from ${formatDate(pd.value)}.`,
    };
  }
  const policy = findMerchantPolicy(merchant);
  if (policy && pd.value) {
    const days = looksLikeElectronics(names) && policy.electronicsReturnDays ? policy.electronicsReturnDays : policy.returnDays;
    return {
      ...base,
      valueDate: addDays(pd.value, days),
      valueNumber: days,
      certainty: "estimated",
      basis: "merchant_policy",
      evidence: null,
      confidence: Math.min(0.7, pd.confidence),
      explanation: `Based on ${policy.name}'s typical ${days}-day return policy. Your receipt doesn't specify the return window.`,
    };
  }
  return {
    ...base,
    certainty: "unknown",
    basis: "none",
    evidence: null,
    confidence: 0,
    explanation: !pd.value
      ? "We couldn't find a purchase date, so we can't work out a return deadline."
      : "Your receipt doesn't list a return policy, and we don't know this store's policy.",
  };
}

/** Stated end > stated months + purchase date > manufacturer default (estimated) > nothing. */
function receiptWarrantyFact(order: VerifiedOrder, names: string[]) {
  const base = { key: "warranty", label: "Warranty" };
  const pd = order.purchaseDate;
  const provider = order.warrantyProvider.value ? prettifyName(order.warrantyProvider.value) : null;
  const covered = order.warrantyCoveredItem.value?.toLowerCase();
  const coveredLine = covered ? order.lineItems.find((l) => l.name.toLowerCase().includes(covered.slice(0, 12))) : undefined;
  const coveredCents = coveredLine?.totalCents ?? null;

  if (order.warrantyEndsOn.value) {
    const v = order.warrantyEndsOn;
    return {
      provider,
      coveredCents,
      fact: { ...base, valueDate: v.value, valueNumber: order.warrantyMonths.value, certainty: v.certainty, basis: v.basis, evidence: v.evidence, confidence: v.confidence, explanation: v.explanation ?? "The warranty end date is printed on your receipt." } as DerivedFact,
    };
  }
  if (order.warrantyMonths.value) {
    const m = order.warrantyMonths;
    const endsOn = pd.value ? addMonths(pd.value, m.value!) : null;
    return {
      provider,
      coveredCents,
      fact: {
        ...base,
        valueDate: endsOn,
        valueNumber: m.value,
        certainty: endsOn ? weakest(m.certainty, pd.certainty) : "unknown",
        basis: endsOn ? "computed_from_document" : "none",
        evidence: m.evidence,
        confidence: endsOn ? Math.min(m.confidence, pd.confidence) : 0,
        explanation: endsOn
          ? `${durationText(m.value!)}${provider ? ` ${provider}` : ""} coverage from ${formatDate(pd.value!)}, as stated on your receipt.`
          : `${durationText(m.value!)} of coverage is stated, but we couldn't find the purchase date.`,
      } as DerivedFact,
    };
  }
  const mfr = findManufacturerWarranty(names);
  if (mfr && pd.value) {
    return {
      provider: mfr.brand,
      coveredCents,
      fact: {
        ...base,
        valueDate: addMonths(pd.value, mfr.months),
        valueNumber: mfr.months,
        certainty: "estimated",
        basis: "manufacturer_default",
        evidence: null,
        confidence: Math.min(0.6, pd.confidence),
        explanation: `Based on ${mfr.note} Your receipt doesn't mention a warranty.`,
      } as DerivedFact,
    };
  }
  return null;
}

// ───────────────────────────── Subscriptions ─────────────────────────────

export function deriveSubscription(s: VerifiedSubscription, ctx: DeriveContext): DerivedItem {
  const service = s.serviceName.value ?? "Subscription";
  const amount = s.amount.value;
  const status = s.status.value ?? (s.trialEndDate.value ? "trial" : "unknown");

  const facts: DerivedFact[] = [
    fact("amount", "Price", s.amount, moneyMap),
    fact("billing_period", "Billing", s.billingPeriod, (v) => ({ valueText: v })),
  ];
  if (s.trialEndDate.value) facts.push(fact("trial_end", "Free trial ends", s.trialEndDate, (v) => ({ valueDate: v })));
  const renewal = fact("next_renewal", "Renews", s.nextRenewalDate, (v) => ({ valueDate: v }));
  if (!s.nextRenewalDate.value) renewal.explanation = "The renewal date isn't stated on this document.";
  facts.push(renewal);

  return finish(
    {
      kind: "subscription",
      title: service,
      merchant: service,
      amountCents: amount?.cents ?? null,
      currency: amount?.currency ?? null,
      primaryDate: s.trialEndDate.value ?? s.nextRenewalDate.value,
      confidence: mean([s.serviceName.confidence, s.amount.confidence, Math.max(s.trialEndDate.confidence, s.nextRenewalDate.confidence)]),
      needsReview: needsReviewFrom(facts, ctx),
      details: { plan: s.planName.value, status },
      categories: ["subscriptions", "renewals"],
      facts,
      typed: {
        subscription: {
          serviceName: service,
          amountCents: amount?.cents ?? null,
          currency: amount?.currency ?? null,
          billingPeriod: s.billingPeriod.value ?? "unknown",
          trialEndsOn: s.trialEndDate.value,
          nextRenewalOn: s.nextRenewalDate.value ?? s.trialEndDate.value,
          renewalCertainty: s.nextRenewalDate.value ? s.nextRenewalDate.certainty : s.trialEndDate.certainty,
          status,
        },
      },
    },
    ctx.today,
  );
}

// ───────────────────────────── Warranties ─────────────────────────────

export function deriveWarranty(w: VerifiedWarranty, ctx: DeriveContext): DerivedItem {
  const product = w.productName.value ? cleanProductName(w.productName.value) : null;
  const start = w.startDate.value ? w.startDate : w.purchaseDate;
  let end: DerivedFact;
  if (w.endDate.value) {
    end = fact("warranty_end", "Coverage ends", w.endDate, (v) => ({ valueDate: v }));
  } else if (w.durationMonths.value && start.value) {
    end = {
      key: "warranty_end",
      label: "Coverage ends",
      valueDate: addMonths(start.value, w.durationMonths.value),
      valueNumber: w.durationMonths.value,
      certainty: weakest(w.durationMonths.certainty, start.certainty),
      basis: "computed_from_document",
      evidence: w.durationMonths.evidence,
      confidence: Math.min(w.durationMonths.confidence, start.confidence),
      explanation: `${durationText(w.durationMonths.value)} from ${formatDate(start.value)}, as stated on the document.`,
    };
  } else {
    end = {
      key: "warranty_end",
      label: "Coverage ends",
      certainty: "unknown",
      basis: "none",
      evidence: null,
      confidence: 0,
      explanation: w.durationMonths.value
        ? `${durationText(w.durationMonths.value)} of coverage is stated, but we couldn't find when it starts.`
        : "We couldn't find when this warranty ends.",
    };
  }

  const facts: DerivedFact[] = [
    end,
    fact("provider", "Provider", w.provider, (v) => ({ valueText: v })),
    fact("purchase_price", "Item price", w.purchasePrice, moneyMap),
    fact("start_date", "Coverage starts", start, (v) => ({ valueDate: v })),
  ];
  if (w.coverageSummary.value) facts.push(fact("coverage", "Covers", w.coverageSummary, (v) => ({ valueText: v })));

  const price = w.purchasePrice.value;
  return finish(
    {
      kind: "warranty",
      title: product ? `${product} warranty` : "Warranty",
      merchant: w.provider.value,
      amountCents: price?.cents ?? null,
      currency: price?.currency ?? null,
      primaryDate: end.valueDate ?? null,
      confidence: mean([end.confidence, w.productName.confidence]),
      needsReview: needsReviewFrom(facts, ctx),
      details: {},
      categories: ["warranties"],
      facts,
      typed: {
        warranty: {
          provider: w.provider.value,
          startsOn: start.value,
          endsOn: end.valueDate ?? null,
          durationMonths: w.durationMonths.value,
          endsOnCertainty: end.certainty,
          coverageSummary: w.coverageSummary.value,
        },
      },
    },
    ctx.today,
  );
}

// ───────────────────────────── Travel credits ─────────────────────────────

export function deriveTravelCredit(t: VerifiedTravelCredit, ctx: DeriveContext): DerivedItem {
  const carrier = t.carrier.value;
  const amount = t.amount.value;
  const exp = t.expirationDate;
  const rule = t.expirationRule.value;
  const expLabel = rule === "travel_by" ? "Travel by" : rule === "book_by" ? "Book by" : "Expires";

  const expFact = fact("expires_on", expLabel, exp, (v) => ({ valueDate: v }));
  if (!exp.value) expFact.explanation = "We couldn't find an expiration date on this credit.";
  const facts: DerivedFact[] = [fact("amount", "Credit", t.amount, moneyMap), fact("carrier", "Airline", t.carrier, (v) => ({ valueText: v })), expFact];
  if (t.creditCode.value) {
    const code = t.creditCode.value;
    // Only a masked tail is ever stored outside the encrypted column.
    facts.push({ ...fact("credit_code", "Credit code", t.creditCode, () => ({ valueText: `•••• ${code.slice(-4)}` })), evidence: null });
  }

  return finish(
    {
      kind: "travel_credit",
      title: `${carrier ?? "Travel"} credit`,
      merchant: carrier,
      amountCents: amount?.cents ?? null,
      currency: amount?.currency ?? null,
      primaryDate: exp.value,
      confidence: mean([t.amount.confidence, exp.confidence, t.carrier.confidence]),
      needsReview: needsReviewFrom(facts, ctx),
      details: { expirationRule: rule },
      categories: ["travel"],
      facts,
      typed: {
        travelCredit: {
          carrier,
          amountCents: amount?.cents ?? null,
          currency: amount?.currency ?? null,
          expiresOn: exp.value,
          expiresOnCertainty: exp.certainty,
          creditReference: t.creditCode.value,
        },
      },
    },
    ctx.today,
  );
}

// ───────────────────────────── Everything else ─────────────────────────────

const GENERIC_KIND: Partial<Record<DocumentType, ItemKind>> = { bill: "bill", appointment: "appointment", insurance: "insurance", vehicle: "vehicle" };
const DATE_LABELS = { due_date: "Due", appointment: "Appointment", expiration: "Expires", renewal: "Renews", other: "Date" } as const;

export function deriveGeneric(g: VerifiedGeneric, ctx: DeriveContext): DerivedItem {
  const kind = GENERIC_KIND[ctx.documentType] ?? "document";
  const title = g.title.value ?? g.organization.value ?? "Document";
  const facts: DerivedFact[] = [];
  if (g.amount.value) facts.push(fact("amount", "Amount", g.amount, moneyMap));
  if (g.organization.value) facts.push(fact("organization", "From", g.organization, (v) => ({ valueText: v })));
  g.keyDates.forEach((k, i) => facts.push(fact(`date_${i}_${k.label}`, DATE_LABELS[k.label], k.date, (v) => ({ valueDate: v }))));
  const cat: CategorySlug = kind === "bill" ? "bills" : kind === "appointment" ? "appointments" : kind === "document" ? "documents" : "other";
  return finish(
    {
      kind,
      title,
      merchant: g.organization.value,
      amountCents: g.amount.value?.cents ?? null,
      currency: g.amount.value?.currency ?? null,
      primaryDate: g.keyDates[0]?.date.value ?? null,
      confidence: mean(facts.map((f) => f.confidence)),
      needsReview: needsReviewFrom(facts, ctx),
      details: {},
      categories: [cat],
      facts,
      typed: {},
    },
    ctx.today,
  );
}

/** A document we filed but found nothing actionable in. */
export function deriveFiledDocument(title: string): DerivedItem {
  return {
    kind: "document",
    title,
    merchant: null,
    amountCents: null,
    currency: null,
    primaryDate: null,
    confidence: 1,
    needsReview: false,
    details: {},
    categories: ["documents"],
    facts: [],
    protections: [],
    actions: [],
    typed: {},
  };
}
