import type { ActionType, Certainty, Consequence } from "@/server/domain/types";
import { daysBetween, formatDate } from "@/server/extraction/dates";
import { formatMoney } from "@/lib/money";

/**
 * Deterministic, explainable prioritization. Not chronological: a $1,299
 * return closing in 3 days outranks a $9.99 renewal in 30.
 */
export type PrioritizableAction = {
  type: ActionType;
  dueOn: string | null;
  dueCertainty: Certainty;
  estimatedValueCents: number | null;
  currency: string | null;
  consequence: Consequence;
  confidence: number;
  userImportance?: number;
};

export type Tier = "needs_attention" | "coming_up" | "later";

const CONSEQUENCE_WEIGHT: Record<Consequence, number> = {
  lose_money: 1,
  charged: 0.8,
  late_fee: 0.7,
  lose_coverage: 0.45,
  inconvenience: 0.35,
};
const CERTAINTY_FACTOR: Record<Certainty, number> = { confirmed: 1, estimated: 0.85, unknown: 0.5 };

export function urgency(daysLeft: number | null): number {
  if (daysLeft == null) return 0.05;
  if (daysLeft <= 0) return 1;
  return 1 / (1 + Math.pow(daysLeft / 5, 1.5));
}

export function valueFactor(cents: number | null): number {
  if (cents == null) return 0.5;
  const dollars = cents / 100;
  return 0.35 + 0.65 * Math.min(1, Math.log10(1 + dollars) / Math.log10(1 + 2000));
}

export function priorityScore(a: PrioritizableAction, today: string): number {
  const d = a.dueOn ? daysBetween(today, a.dueOn) : null;
  const base = urgency(d) * CONSEQUENCE_WEIGHT[a.consequence] * valueFactor(a.estimatedValueCents) * CERTAINTY_FACTOR[a.dueCertainty];
  return Math.round((100 * base + 10 * (a.userImportance ?? 0)) * 100) / 100;
}

export function tierFor(a: PrioritizableAction, today: string): Tier {
  const d = a.dueOn ? daysBetween(today, a.dueOn) : null;
  const score = priorityScore(a, today);
  const costly = a.consequence === "lose_money" || a.consequence === "charged" || a.consequence === "late_fee";
  if ((a.userImportance ?? 0) > 0 && d != null && d <= 30) return "needs_attention";
  if (score >= 10) return "needs_attention";
  if (d != null && d <= 7 && costly) return "needs_attention";
  if (d != null && d <= 30 && a.consequence === "lose_money" && (a.estimatedValueCents ?? 0) >= 25_000) return "needs_attention";
  if (d != null && d <= 60) return "coming_up";
  return "later";
}

export function relativeDays(today: string, due: string): string {
  const d = daysBetween(today, due);
  if (d < 0) return d === -1 ? "yesterday" : `${-d} days ago`;
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d <= 21) return `in ${d} days`;
  if (d <= 60) return `in ${Math.round(d / 7)} weeks`;
  return `on ${formatDate(due)}`;
}

/** One sentence explaining WHY this matters. Estimated dates are always labeled. */
export function priorityReason(a: PrioritizableAction, today: string): string {
  const amount = a.estimatedValueCents != null ? formatMoney(a.estimatedValueCents, a.currency ?? "USD") : null;
  if (!a.dueOn) return "No date found — worth a look.";
  const when = relativeDays(today, a.dueOn);
  const est = a.dueCertainty === "estimated";
  const closes = est ? `likely closes ${when} (estimated)` : `closes ${when}`;
  switch (a.type) {
    case "return":
      return amount ? `Your ${amount} return window ${closes}.` : `Your return window ${closes}.`;
    case "cancel_trial":
      return amount
        ? `Your free trial becomes a ${amount} charge ${when}${est ? " (estimated)" : ""}.`
        : `Your free trial ends ${when}${est ? " (estimated)" : ""}.`;
    case "review_renewal":
      return amount ? `Renews for ${amount} ${when}${est ? " (estimated)" : ""}.` : `Renews ${when}${est ? " (estimated)" : ""}.`;
    case "use_credit":
      return amount ? `${amount} credit expires ${when}${est ? " (estimated)" : ""}.` : `Credit expires ${when}.`;
    case "warranty_expiring":
      return amount ? `Coverage on your ${amount} purchase ends ${when}${est ? " (estimated)" : ""}.` : `Coverage ends ${when}${est ? " (estimated)" : ""}.`;
    case "pay_bill":
      return amount ? `${amount} due ${when}.` : `Payment due ${when}.`;
    case "attend":
      return `Scheduled ${when}.`;
    default:
      return `Due ${when}.`;
  }
}
