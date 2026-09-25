import type { ActionType, Basis, Certainty, Consequence, ItemKind, ProtectionKind } from "@/server/domain/types";
import { daysBetween, formatDate } from "@/server/extraction/dates";
import { formatMoney } from "@/lib/money";

/**
 * Facts are canonical. Protections (money protected) and actions (what to do)
 * are always planned from facts by this one function — at extraction time and
 * again whenever the user edits or confirms a fact — so they can never drift.
 */
export type FactLike = {
  key: string;
  label: string;
  valueText?: string | null;
  valueDate?: string | null;
  valueCents?: number | null;
  valueNumber?: number | null;
  currency?: string | null;
  certainty: Certainty;
  basis: Basis;
  explanation: string | null;
  confidence: number;
};

export type PlannedProtection = {
  kind: ProtectionKind;
  amountCents: number;
  currency: string;
  activeUntil: string | null;
  certainty: Certainty;
  status: "active" | "expired";
};

export type PlannedAction = {
  type: ActionType;
  title: string;
  description: string | null;
  dueOn: string | null;
  dueCertainty: Certainty;
  estimatedValueCents: number | null;
  currency: string | null;
  consequence: Consequence;
  suggestedAction: string | null;
  confidence: number;
  protectionKind?: ProtectionKind;
};

export type PlanInput = {
  kind: ItemKind;
  title: string;
  merchant: string | null;
  facts: FactLike[];
  details: Record<string, unknown>;
};

const known = (f: FactLike | undefined): f is FactLike => !!f && f.certainty !== "unknown";
const isOpen = (today: string, d: string) => daysBetween(today, d) >= 0;

export function planFromFacts(item: PlanInput, today: string): { protections: PlannedProtection[]; actions: PlannedAction[] } {
  const get = (k: string) => item.facts.find((f) => f.key === k);
  const protections: PlannedProtection[] = [];
  const actions: PlannedAction[] = [];

  switch (item.kind) {
    case "purchase": {
      const total = get("total");
      const cents = known(total) ? total.valueCents ?? null : null;
      const currency = total?.currency ?? "USD";
      const ret = get("return_deadline");
      if (known(ret) && ret.valueDate && cents != null) {
        const open = isOpen(today, ret.valueDate);
        protections.push({ kind: "return_window", amountCents: cents, currency, activeUntil: ret.valueDate, certainty: ret.certainty, status: open ? "active" : "expired" });
        if (open) {
          actions.push({
            type: "return",
            title: `Return window: ${item.title}`,
            description: ret.explanation,
            dueOn: ret.valueDate,
            dueCertainty: ret.certainty,
            estimatedValueCents: cents,
            currency,
            consequence: "lose_money",
            suggestedAction: `Decide whether to keep it before ${formatDate(ret.valueDate, { withYear: false })}.`,
            confidence: ret.confidence,
            protectionKind: "return_window",
          });
        }
      }
      const war = get("warranty");
      if (known(war) && war.valueDate) {
        const covered = (item.details.warrantyCoveredCents as number | null | undefined) ?? cents;
        const open = isOpen(today, war.valueDate);
        if (covered != null) {
          protections.push({ kind: "warranty", amountCents: covered, currency, activeUntil: war.valueDate, certainty: war.certainty, status: open ? "active" : "expired" });
        }
        if (open) {
          actions.push({
            type: "warranty_expiring",
            title: `Warranty ends: ${item.title}`,
            description: war.explanation,
            dueOn: war.valueDate,
            dueCertainty: war.certainty,
            estimatedValueCents: covered,
            currency,
            consequence: "lose_coverage",
            suggestedAction: "Check the item for problems before coverage ends.",
            confidence: war.confidence,
            protectionKind: covered != null ? "warranty" : undefined,
          });
        }
      }
      break;
    }

    case "subscription": {
      const amount = get("amount");
      const cents = known(amount) ? amount.valueCents ?? null : null;
      const currency = amount?.currency ?? "USD";
      const period = get("billing_period")?.valueText;
      const per = period === "monthly" ? "/mo" : period === "annual" ? "/yr" : period === "weekly" ? "/wk" : "";
      const price = cents != null ? `${formatMoney(cents, currency)}${per}` : "the full price";
      if (item.details.status === "cancelled") break;
      const service = item.title;
      const trial = get("trial_end");
      if (known(trial) && trial.valueDate && isOpen(today, trial.valueDate)) {
        actions.push({
          type: "cancel_trial",
          title: `Free trial ends: ${service}`,
          description: `Your trial converts to ${price}.`,
          dueOn: trial.valueDate,
          dueCertainty: trial.certainty,
          estimatedValueCents: cents,
          currency,
          consequence: "charged",
          suggestedAction: `Cancel before ${formatDate(trial.valueDate, { withYear: false })} if you don't want to pay ${price}.`,
          confidence: trial.confidence,
        });
      }
      const renew = get("next_renewal");
      const sameAsTrial = known(trial) && trial.valueDate && renew?.valueDate && Math.abs(daysBetween(trial.valueDate, renew.valueDate)) <= 1;
      if (known(renew) && renew.valueDate && isOpen(today, renew.valueDate) && !sameAsTrial) {
        actions.push({
          type: "review_renewal",
          title: `${service} renews`,
          description: `Renews at ${price}.`,
          dueOn: renew.valueDate,
          dueCertainty: renew.certainty,
          estimatedValueCents: cents,
          currency,
          consequence: "charged",
          suggestedAction: "Keep it, or cancel before it renews.",
          confidence: renew.confidence,
        });
      }
      break;
    }

    case "warranty": {
      const end = get("warranty_end");
      const price = get("purchase_price");
      const cents = known(price) ? price.valueCents ?? null : null;
      const currency = price?.currency ?? "USD";
      if (known(end) && end.valueDate) {
        const open = isOpen(today, end.valueDate);
        if (cents != null) protections.push({ kind: "warranty", amountCents: cents, currency, activeUntil: end.valueDate, certainty: end.certainty, status: open ? "active" : "expired" });
        if (open) {
          actions.push({
            type: "warranty_expiring",
            title: `Warranty ends: ${item.title.replace(/ warranty$/i, "")}`,
            description: end.explanation,
            dueOn: end.valueDate,
            dueCertainty: end.certainty,
            estimatedValueCents: cents,
            currency: cents != null ? currency : null,
            consequence: "lose_coverage",
            suggestedAction: "Check the item for problems before coverage ends.",
            confidence: end.confidence,
            protectionKind: cents != null ? "warranty" : undefined,
          });
        }
      }
      break;
    }

    case "travel_credit": {
      const amount = get("amount");
      const exp = get("expires_on");
      const cents = known(amount) ? amount.valueCents ?? null : null;
      const currency = amount?.currency ?? "USD";
      const rule = item.details.expirationRule;
      if (cents != null && known(exp) && exp.valueDate) {
        const open = isOpen(today, exp.valueDate);
        protections.push({ kind: "travel_credit", amountCents: cents, currency, activeUntil: exp.valueDate, certainty: exp.certainty, status: open ? "active" : "expired" });
        if (open) {
          actions.push({
            type: "use_credit",
            title: `Use ${item.merchant ? `${item.merchant} ` : ""}credit`,
            description: rule === "travel_by" ? "Travel must be completed by this date." : rule === "book_by" ? "Book by this date." : null,
            dueOn: exp.valueDate,
            dueCertainty: exp.certainty,
            estimatedValueCents: cents,
            currency,
            consequence: "lose_money",
            suggestedAction: `Use your ${formatMoney(cents, currency)} credit before it expires.`,
            confidence: Math.min(exp.confidence, amount!.confidence),
            protectionKind: "travel_credit",
          });
        }
      }
      break;
    }

    default: {
      const amount = get("amount");
      const cents = known(amount) ? amount.valueCents ?? null : null;
      const currency = amount?.currency ?? null;
      for (const f of item.facts) {
        const m = /^date_\d+_(\w+)$/.exec(f.key);
        if (!m || !known(f) || !f.valueDate || !isOpen(today, f.valueDate)) continue;
        const label = m[1];
        if (label === "due_date" && item.kind === "bill") {
          actions.push({ type: "pay_bill", title: `Pay ${item.title}`, description: null, dueOn: f.valueDate, dueCertainty: f.certainty, estimatedValueCents: cents, currency, consequence: "late_fee", suggestedAction: "Pay before the due date to avoid a late fee.", confidence: f.confidence });
        } else if (label === "appointment") {
          actions.push({ type: "attend", title: item.title, description: null, dueOn: f.valueDate, dueCertainty: f.certainty, estimatedValueCents: null, currency: null, consequence: "inconvenience", suggestedAction: null, confidence: f.confidence });
        } else if (label === "expiration" || label === "renewal") {
          actions.push({ type: "review_renewal", title: `${item.title} ${label === "renewal" ? "renews" : "expires"}`, description: null, dueOn: f.valueDate, dueCertainty: f.certainty, estimatedValueCents: cents, currency, consequence: "inconvenience", suggestedAction: null, confidence: f.confidence });
        }
      }
    }
  }
  // One action per type per item (DB-enforced); keep the earliest.
  const seen = new Set<string>();
  return {
    protections,
    actions: actions
      .sort((a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999"))
      .filter((a) => (seen.has(a.type) ? false : (seen.add(a.type), true))),
  };
}
