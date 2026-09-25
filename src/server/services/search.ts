import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { schema, withUser } from "@/server/db/client";
import type { ItemKind } from "@/server/domain/types";
import { addDays, formatDate } from "@/server/extraction/dates";
import { formatMoney } from "@/lib/money";
import { moneySummary, userContext } from "./items";

/**
 * Lightweight structured search. A deterministic parser turns common questions
 * into a filter over structured data; anything else falls back to full-text
 * search. The model never writes queries.
 */
export type SearchPlan = {
  interpretation: string;
  kinds: ItemKind[];
  merchant: string | null;
  range: { from: string; to: string; label: string } | null;
  withWarranty: boolean;
  aggregate: "money_protected" | "warranty_value" | "spend" | null;
  deadlines: boolean;
  text: string | null;
};

const KIND_WORDS: Array<[RegExp, ItemKind]> = [
  [/\bwarrant(y|ies)\b|\bprotection plan/, "warranty"],
  [/\bsubscriptions?\b|\btrials?\b|\bmemberships?\b/, "subscription"],
  [/\b(travel |airline |flight )?credits?\b|\bvouchers?\b|\becredits?\b/, "travel_credit"],
  [/\bbills?\b/, "bill"],
  [/\bappointments?\b/, "appointment"],
  [/\bpurchases?\b|\bbought\b|\borders?\b|\breceipts?\b/, "purchase"],
];

function endOfMonth(iso: string) {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function parseQuery(q: string, today: string, merchants: string[]): SearchPlan {
  const s = q.toLowerCase().trim();
  const plan: SearchPlan = { interpretation: "", kinds: [], merchant: null, range: null, withWarranty: false, aggregate: null, deadlines: false, text: null };

  // Time windows
  if (/\bthis month\b/.test(s)) plan.range = { from: today, to: endOfMonth(today), label: "this month" };
  else if (/\bnext month\b/.test(s)) {
    const start = addDays(endOfMonth(today), 1);
    plan.range = { from: start, to: endOfMonth(start), label: "next month" };
  } else if (/\bthis week\b/.test(s)) plan.range = { from: today, to: addDays(today, 7 - new Date(`${today}T00:00:00Z`).getUTCDay()), label: "this week" };
  else if (/\btoday\b/.test(s)) plan.range = { from: today, to: today, label: "today" };
  else if (/\btomorrow\b/.test(s)) plan.range = { from: addDays(today, 1), to: addDays(today, 1), label: "tomorrow" };
  else if (/\bnext (\d+) days\b/.test(s)) {
    const n = Math.min(Number(/\bnext (\d+) days\b/.exec(s)![1]), 3650);
    plan.range = { from: today, to: addDays(today, n), label: `in the next ${n} days` };
  } else if (/\b(soon|coming up|upcoming)\b/.test(s)) plan.range = { from: today, to: addDays(today, 30), label: "in the next 30 days" };
  else if (/\bthis year\b/.test(s)) plan.range = { from: today, to: `${today.slice(0, 4)}-12-31`, label: "this year" };

  if (/\b(expir\w*|due|ending|ends|renew\w*|deadline\w*|return by)\b/.test(s) || (plan.range && !/\bbought|spent|purchased\b/.test(s))) plan.deadlines = true;

  for (const [re, kind] of KIND_WORDS) if (re.test(s) && !plan.kinds.includes(kind)) plan.kinds.push(kind);
  if (/\b(with|have|has) (a )?warrant/.test(s) || (plan.kinds.includes("purchase") && plan.kinds.includes("warranty"))) {
    plan.withWarranty = true;
    plan.kinds = ["purchase", "warranty"];
  }

  const merchant = merchants
    .filter((m) => m && m.length >= 3)
    .sort((a, b) => b.length - a.length)
    .find((m) => s.includes(m.toLowerCase()));
  if (merchant) plan.merchant = merchant;
  else {
    const at = /\b(?:at|from)\s+([a-z0-9'&.\- ]{2,40}?)(?:\?|$|\s+(?:this|last|in|since)\b)/.exec(s);
    if (at && !/^(the|my|a)$/.test(at[1]!.trim())) plan.merchant = at[1]!.trim();
  }

  if (/\bhow much\b|\btotal\b/.test(s)) {
    if (/\bwarrant/.test(s)) plan.aggregate = "warranty_value";
    else if (/\b(spen[dt]|bought|paid|purchases?)\b/.test(s)) plan.aggregate = "spend";
    else plan.aggregate = "money_protected";
  }

  const structured = plan.kinds.length || plan.merchant || plan.range || plan.aggregate || plan.withWarranty;
  if (!structured) plan.text = q.trim();

  // Human-readable interpretation
  const parts: string[] = [];
  if (plan.aggregate === "money_protected") parts.push("Money currently protected");
  else if (plan.aggregate === "warranty_value") parts.push("Value covered by active warranties");
  else if (plan.aggregate === "spend") parts.push("Total spent");
  else if (plan.withWarranty) parts.push("Purchases with warranties");
  else if (plan.deadlines) parts.push(plan.kinds.length ? `${plan.kinds.map(kindLabel).join(" and ")} with deadlines` : "Deadlines");
  else if (plan.kinds.length) parts.push(plan.kinds.map(kindLabel).join(" and "));
  else if (plan.text) parts.push(`Matches for “${plan.text}”`);
  else parts.push("Items");
  if (plan.merchant) parts.push(`at ${plan.merchant}`);
  if (plan.range) parts.push(plan.range.label);
  plan.interpretation = parts.join(" ");
  return plan;
}

function kindLabel(k: ItemKind) {
  return { purchase: "Purchases", subscription: "Subscriptions", warranty: "Warranties", travel_credit: "Travel credits", bill: "Bills", appointment: "Appointments" }[k as string] ?? "Items";
}

export type SearchResult = {
  interpretation: string;
  total: { label: string; cents: number; currency: string; count: number } | null;
  results: Array<{ itemId: string; title: string; kind: string; merchant: string | null; line: string; amount: string | null }>;
  documents: Array<{ id: string; filename: string }>;
};

export async function search(userId: string, q: string): Promise<SearchResult> {
  const { today } = await userContext(userId);
  return withUser(userId, async (tx) => {
    const merchants = (await tx.selectDistinct({ m: schema.items.merchant }).from(schema.items).where(eq(schema.items.userId, userId))).map((r) => r.m ?? "");
    const plan = parseQuery(q, today, merchants);
    const base = and(eq(schema.items.userId, userId), inArray(schema.items.state, ["active", "saved"]), isNull(schema.items.possibleDuplicateOf));
    const merchantCond = plan.merchant ? sql`${schema.items.merchant} ilike ${"%" + plan.merchant.replace(/[%_]/g, "") + "%"}` : undefined;
    const kindCond = plan.kinds.length ? inArray(schema.items.kind, plan.kinds) : undefined;
    const money = (c: number | null, cur: string | null) => (c != null ? formatMoney(c, cur ?? "USD") : null);

    let total: SearchResult["total"] = null;
    let results: SearchResult["results"] = [];

    if (plan.aggregate === "money_protected") {
      const m = await moneySummary(tx, userId, today);
      total = { label: "Money protected", cents: m.protectedCents, currency: m.currency, count: m.itemCount };
      const rows = await tx
        .select({ item: schema.items, p: schema.protections })
        .from(schema.protections)
        .innerJoin(schema.items, eq(schema.items.id, schema.protections.itemId))
        .where(and(base, eq(schema.protections.status, "active"), gte(schema.protections.activeUntil, today)))
        .orderBy(schema.protections.activeUntil);
      const seen = new Set<string>();
      results = rows.filter((r) => (seen.has(r.item.id) ? false : (seen.add(r.item.id), true))).map((r) => ({
        itemId: r.item.id, title: r.item.title, kind: r.item.kind, merchant: r.item.merchant,
        line: `${r.p.kind.replace("_", " ")} until ${formatDate(r.p.activeUntil!)}${r.p.certainty === "estimated" ? " (estimated)" : ""}`,
        amount: money(r.p.amountCents, r.p.currency),
      }));
    } else if (plan.aggregate === "warranty_value" || plan.withWarranty) {
      const rows = await tx
        .select({ item: schema.items, w: schema.warranties })
        .from(schema.warranties)
        .innerJoin(schema.items, eq(schema.items.id, schema.warranties.itemId))
        .where(and(base, merchantCond, plan.aggregate ? gte(schema.warranties.endsOn, today) : undefined))
        .orderBy(schema.warranties.endsOn);
      results = rows.map((r) => ({
        itemId: r.item.id, title: r.item.title, kind: r.item.kind, merchant: r.item.merchant,
        line: r.w.endsOn ? `Covered until ${formatDate(r.w.endsOn)}${r.w.endsOnCertainty === "estimated" ? " (estimated)" : ""}` : "End date unknown",
        amount: money(r.item.amountCents, r.item.currency),
      }));
      if (plan.aggregate) {
        const cents = rows.reduce((s, r) => s + (r.item.amountCents ?? 0), 0);
        total = { label: "Covered by active warranties", cents, currency: rows[0]?.item.currency ?? "USD", count: rows.length };
      }
    } else if (plan.aggregate === "spend") {
      const rows = await tx
        .select({ item: schema.items, p: schema.purchases })
        .from(schema.purchases)
        .innerJoin(schema.items, eq(schema.items.id, schema.purchases.itemId))
        .where(and(base, merchantCond, plan.range ? and(gte(schema.purchases.purchaseDate, plan.range.from), lte(schema.purchases.purchaseDate, plan.range.to)) : undefined))
        .orderBy(desc(schema.purchases.purchaseDate));
      const cents = rows.reduce((s, r) => s + (r.p.totalCents ?? 0), 0);
      total = { label: plan.merchant ? `Spent at ${plan.merchant}` : "Total spent", cents, currency: rows[0]?.item.currency ?? "USD", count: rows.length };
      results = rows.map((r) => ({ itemId: r.item.id, title: r.item.title, kind: "purchase", merchant: r.item.merchant, line: r.p.purchaseDate ? `Purchased ${formatDate(r.p.purchaseDate)}` : "Purchase", amount: money(r.p.totalCents, r.item.currency) }));
    } else if (plan.deadlines) {
      const rows = await tx
        .select({ a: schema.actions, item: schema.items })
        .from(schema.actions)
        .innerJoin(schema.items, eq(schema.items.id, schema.actions.itemId))
        .where(and(base, kindCond, merchantCond, inArray(schema.actions.status, ["open", "snoozed"]), gte(schema.actions.dueOn, plan.range?.from ?? today), plan.range ? lte(schema.actions.dueOn, plan.range.to) : undefined))
        .orderBy(schema.actions.dueOn);
      results = rows.map((r) => ({ itemId: r.item.id, title: r.a.title, kind: r.item.kind, merchant: r.item.merchant, line: `${formatDate(r.a.dueOn!)}${r.a.dueCertainty === "estimated" ? " · estimated" : ""}`, amount: money(r.a.estimatedValueCents, r.a.currency) }));
    } else if (plan.text) {
      const rows = await tx
        .select()
        .from(schema.items)
        .where(and(base, sql`(${schema.items.searchVector} @@ websearch_to_tsquery('english', ${plan.text}) or ${schema.items.title} ilike ${"%" + plan.text.replace(/[%_]/g, "") + "%"} or ${schema.items.merchant} ilike ${"%" + plan.text.replace(/[%_]/g, "") + "%"})`))
        .orderBy(desc(schema.items.createdAt))
        .limit(50);
      results = rows.map((i) => ({ itemId: i.id, title: i.title, kind: i.kind, merchant: i.merchant, line: i.primaryDate ? formatDate(i.primaryDate) : i.kind.replace("_", " "), amount: money(i.amountCents, i.currency) }));
    } else {
      const rows = await tx.select().from(schema.items).where(and(base, kindCond, merchantCond)).orderBy(desc(schema.items.primaryDate)).limit(100);
      results = rows.map((i) => ({ itemId: i.id, title: i.title, kind: i.kind, merchant: i.merchant, line: i.primaryDate ? `${i.kind === "purchase" ? "Purchased " : ""}${formatDate(i.primaryDate)}` : i.kind.replace("_", " "), amount: money(i.amountCents, i.currency) }));
      if (plan.kinds.length === 1 && plan.kinds[0] === "purchase") {
        const cents = rows.reduce((s, r) => s + (r.amountCents ?? 0), 0);
        total = { label: plan.merchant ? `Spent at ${plan.merchant}` : "Total", cents, currency: rows[0]?.currency ?? "USD", count: rows.length };
      }
    }

    // Documents search runs for free-text queries (over extracted, redacted text).
    const documents = plan.text
      ? await tx
          .select({ id: schema.documents.id, filename: schema.documents.originalFilename })
          .from(schema.documents)
          .where(and(eq(schema.documents.userId, userId), sql`${schema.documents.searchVector} @@ websearch_to_tsquery('english', ${plan.text})`))
          .limit(20)
      : [];

    return { interpretation: plan.interpretation, total, results, documents };
  });
}
