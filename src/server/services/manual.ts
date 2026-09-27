import { and, eq, gte, sql } from "drizzle-orm";
import { audit } from "@/server/audit/log";
import { schema, withUser } from "@/server/db/client";
import { durationText } from "@/server/derivation/derive";
import { findManufacturerWarranty, findMerchantPolicy, looksLikeElectronics } from "@/server/derivation/merchantPolicies";
import { addDays, addMonths, formatDate } from "@/server/extraction/dates";
import { enqueue } from "@/server/jobs/queue";
import { QUEUES } from "@/server/jobs/queues";
import { needsPolicyLookup } from "@/server/policies/apply";
import { InputError, userContext } from "./items";
import { syncItemFromFacts } from "./sync";

/**
 * "Lost the receipt": the user tells us the item, the store and roughly when
 * they bought it. What they typed is "user entered"; everything we add is
 * "estimated" with a source, and deadlines need a purchase date.
 */

export type ManualPurchaseInput = {
  item: string;
  store: string;
  purchaseDate: string | null;
  dateCertainty: "exact" | "approx" | "unknown";
  priceCents: number | null;
};

const DAILY_LIMIT = 30;

export async function createManualPurchase(userId: string, input: ManualPurchaseInput, opts: { now?: Date } = {}) {
  const item = input.item.trim().replace(/\s+/g, " ");
  const store = input.store.trim().replace(/\s+/g, " ");
  if (item.length < 2 || item.length > 120) throw new InputError("Tell us what you bought (2–120 characters).");
  if (store.length < 2 || store.length > 80) throw new InputError("Tell us where you bought it.");
  const { today, tz } = await userContext(userId, opts.now);
  const date = input.dateCertainty === "unknown" ? null : input.purchaseDate;
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today)) throw new InputError("Choose a purchase date that isn't in the future.");
  if (input.priceCents != null && (input.priceCents < 0 || input.priceCents > 100_000_000)) throw new InputError("That price doesn't look right.");

  const itemId = await withUser(userId, async (tx) => {
    const [recent] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.items)
      .where(and(eq(schema.items.userId, userId), gte(schema.items.createdAt, new Date(Date.now() - 86_400_000)), sql`${schema.items.details}->>'manual' = 'true'`));
    if ((recent?.n ?? 0) >= DAILY_LIMIT) throw new InputError("You've added a lot by hand today. Try again tomorrow.");

    const [row] = await tx
      .insert(schema.items)
      .values({ userId, kind: "purchase", title: item, merchant: store, amountCents: input.priceCents, currency: "USD", primaryDate: date, details: { manual: true }, confidence: 1 })
      .returning({ id: schema.items.id });
    const id = row!.id;
    await tx.insert(schema.purchases).values({ itemId: id, userId, purchaseDate: date, totalCents: input.priceCents, lineItems: [{ name: item, quantity: 1, totalCents: input.priceCents }] });

    const facts: (typeof schema.itemFacts.$inferInsert)[] = [];
    facts.push(
      date
        ? {
            userId, itemId: id, key: "purchase_date", label: "Purchased", valueDate: date,
            certainty: input.dateCertainty === "exact" ? "confirmed" : "estimated",
            basis: "user_entered", confidence: input.dateCertainty === "exact" ? 0.95 : 0.6, sortOrder: 1,
            explanation: input.dateCertainty === "exact" ? "You entered this date." : "An approximate date you entered.",
          }
        : { userId, itemId: id, key: "purchase_date", label: "Purchased", certainty: "unknown", basis: "none", confidence: 0, sortOrder: 1, explanation: "Add the date you bought it to see your deadlines." },
    );
    if (input.priceCents != null) {
      facts.push({ userId, itemId: id, key: "total", label: "Amount", valueCents: input.priceCents, currency: "USD", certainty: "confirmed", basis: "user_entered", confidence: 0.95, sortOrder: 2, explanation: "You entered this amount." });
    }

    // Our reviewed store/brand list first (free, instant); the web lookup fills gaps afterwards.
    const policy = findMerchantPolicy(store);
    if (policy) {
      const days = looksLikeElectronics([item]) && policy.electronicsReturnDays ? policy.electronicsReturnDays : policy.returnDays;
      facts.push({
        userId, itemId: id, key: "return_deadline", label: "Return window", valueNumber: days,
        valueDate: date ? addDays(date, days) : null, certainty: date ? "estimated" : "unknown", basis: "merchant_policy",
        confidence: date ? 0.55 : 0, sortOrder: 3,
        explanation: date ? `Based on ${policy.name}'s typical ${days}-day return policy, from the date you entered (${formatDate(date)}).` : `${policy.name} usually allows ${days} days. Add your purchase date to see your deadline.`,
      });
    }
    const mfr = findManufacturerWarranty([item]);
    if (mfr) {
      facts.push({
        userId, itemId: id, key: "warranty", label: "Warranty", valueNumber: mfr.months,
        valueDate: date ? addMonths(date, mfr.months) : null, certainty: date ? "estimated" : "unknown", basis: "manufacturer_default",
        confidence: date ? 0.5 : 0, sortOrder: 4,
        explanation: `Based on ${mfr.note} ${date ? "" : `(${durationText(mfr.months)}) Add your purchase date to see when it ends.`}`.trim(),
      });
    }
    await tx.insert(schema.itemFacts).values(facts);
    await syncItemFromFacts(tx, userId, id, today, tz);
    await audit(tx, { userId, event: "item.manual_created", entityType: "item", entityId: id });
    return id;
  });

  if (await needsPolicyLookup(userId, itemId)) await enqueue(QUEUES.lookupPolicy, { userId, itemId });
  return itemId;
}
